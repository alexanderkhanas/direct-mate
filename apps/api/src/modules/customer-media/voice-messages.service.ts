import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createOpenAI, type OpenAIProvider } from '@ai-sdk/openai';
import { experimental_transcribe as transcribe } from 'ai';
import { randomUUID } from 'crypto';
import { mkdir, mkdtemp, readFile, rm, stat } from 'fs/promises';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { DataSource } from 'typeorm';
import { MessageDirection } from '@direct-mate/shared';
import { FFMPEG, parseDuration, runFfmpeg } from '../../common/ffmpeg';
import { uploadPath, uploadsRoot } from '../../common/uploads';
import { Slots } from '../content-media/video-frames';
import { MAX_VOICE_SECONDS, type MessageAttachment } from '../conversations/entities/message.entity';
import { downloadToFile, MediaFailure } from './customer-media.service';

export const DEFAULT_TRANSCRIBE_MODEL = 'gpt-4o-mini-transcribe';
/** How long a turn waits for a transcription still running. On Instagram that's on top of the 5 s reply debounce. */
export const VOICE_WAIT_MS = 15_000;
const MAX_SOURCE_BYTES = 25 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 20_000;
const CONVERT_TIMEOUT_MS = 20_000;
const TRANSCRIBE_TIMEOUT_MS = 45_000;
/** A voice message tried once isn't tried again for this long (a failed one would otherwise retry every turn). */
const ATTEMPT_MEMORY_MS = 10 * 60 * 1000;
/** A transcription still running after this stops holding up anyone waiting on its conversation. */
const TRACK_TIMEOUT_MS = 90_000;
const FOLDER = 'customer-media';
/** Only local files, as the containers voice messages come in: a crafted file can't make ffmpeg open a URL. */
const INPUT_LIMITS = ['-protocol_whitelist', 'file', '-format_whitelist', 'mov,mp4,m4a,3gp,3g2,mj2,matroska,webm,ogg,mp3,wav,aac'];
/** Words the transcription should expect, so «Нова Пошта» or «розмір L» come out right. */
const VOCABULARY_HINT =
  'Голосове повідомлення клієнта інтернет-магазину в Instagram: товари, розміри, кольори, ціни, доставка Новою Поштою, оплата.';

/** What a voice message's attachment gains: our copy and its transcript, or why there is none. */
export type VoiceResult = Pick<MessageAttachment, 'url' | 'seconds' | 'clipped' | 'transcript' | 'transcribedBy' | 'error'>;

/**
 * The customer's voice messages, as text the AI agent reads.
 *
 * - **Copied on arrival.** Instagram's link expires, so the file is
 *   downloaded once and kept as a mono MP3 under
 *   `uploads/customer-media/<tenant>/` (a manager can listen to it; it is
 *   transcribed again from there if the first try failed). At most
 *   MAX_VOICE_SECONDS are kept.
 * - **Transcribed** by `TRANSCRIBE_MODEL`, the transcript written onto the
 *   message's attachment with the length and the model (what it cost).
 * - **Started when the message is saved;** the conversation's next turn waits
 *   for it in `prepare`, up to VOICE_WAIT_MS.
 *
 * Never throws. A file that can't be fetched or read gets `error`, and the
 * agent asks the customer to write; a failed transcription leaves the copy
 * without a transcript, so a later turn tries again.
 */
@Injectable()
export class VoiceMessagesService {
  private readonly logger = new Logger(VoiceMessagesService.name);
  private readonly converting = new Slots(2, 50);
  private openai: OpenAIProvider | null = null;
  /** Transcriptions each conversation's next turn should wait for. */
  private readonly pending = new Map<string, Set<Promise<void>>>();
  /** `messageId:index` → when its transcription started. */
  private readonly attempted = new Map<string, number>();

  constructor(
    private readonly dataSource: DataSource,
    private readonly config: ConfigService,
  ) {}

  /** Start on each voice message in a saved message that has no transcript yet. Returns at once. */
  startForMessage(tenantId: string, conversationId: string, messageId: string, attachments: MessageAttachment[]): void {
    for (const [index, attachment] of attachments.entries()) {
      if (attachment.type !== 'customer_audio' || attachment.transcript !== undefined || attachment.error) continue;
      const key = `${messageId}:${index}`;
      if (this.triedRecently(key)) continue;
      this.remember(key);
      const task = this.process(tenantId, attachment)
        .then((result) => this.write(messageId, index, { ...attachment, ...defined(result) }))
        .catch((err) => this.logger.warn(`Voice message ${messageId} not written: ${errorText(err)}`));
      this.track(conversationId, task);
    }
  }

  /**
   * Before a turn: start on the voice messages in the customer's new messages
   * that haven't been transcribed, and wait up to `waitMs` for every
   * transcription still running for this conversation.
   */
  async prepare(tenantId: string, conversationId: string, waitMs = VOICE_WAIT_MS): Promise<void> {
    try {
      const rows: Array<{ id: string; attachments: MessageAttachment[] | null }> = await this.dataSource.query(
        `SELECT id, attachments FROM messages
          WHERE conversation_id = $1 AND direction = $2 AND attachments @> '[{"type": "customer_audio"}]'
            AND created_at > COALESCE(
              (SELECT max(created_at) FROM messages WHERE conversation_id = $1 AND direction = $3), '-infinity')
          ORDER BY created_at`,
        [conversationId, MessageDirection.Inbound, MessageDirection.Outbound],
      );
      for (const row of rows) {
        if (Array.isArray(row.attachments)) this.startForMessage(tenantId, conversationId, row.id, row.attachments);
      }
      const waiting = [...(this.pending.get(conversationId) ?? [])];
      if (waiting.length > 0) await withDeadline(Promise.all(waiting), waitMs, undefined);
    } catch (err) {
      this.logger.warn(`Preparing voice messages for ${conversationId} failed (turn goes on): ${errorText(err)}`);
    }
  }

  /** Our copy (made now, or the one kept from an earlier try), then its transcript. */
  async process(tenantId: string, attachment: MessageAttachment): Promise<VoiceResult> {
    let copy: Pick<VoiceResult, 'url' | 'seconds' | 'clipped'>;
    if (attachment.url) {
      copy = { url: attachment.url, seconds: attachment.seconds, clipped: attachment.clipped };
    } else {
      if (!/^https?:\/\//i.test(attachment.mediaId)) return { error: 'download_failed' };
      try {
        copy = await this.copy(tenantId, attachment.mediaId);
      } catch (err) {
        const reason = err instanceof MediaFailure ? err.reason : 'download_failed';
        this.logger.warn(`Voice message not copied (${reason}): ${errorText(err)}`);
        return { error: reason };
      }
    }
    const file = copy.url ? uploadPath(copy.url) : null;
    if (!file) return { error: 'unreadable' };
    try {
      const { text, model } = await this.transcribe(await readFile(file));
      return { ...copy, transcript: text, transcribedBy: model };
    } catch (err) {
      this.logger.warn(`Voice message ${copy.url} not transcribed (a later turn tries again): ${errorText(err)}`);
      return copy;
    }
  }

  /**
   * Download the voice message and keep it as a mono MP3 (speech needs no
   * more; it plays everywhere). Throws `MediaFailure`.
   */
  protected async copy(tenantId: string, source: string): Promise<Pick<VoiceResult, 'url' | 'seconds' | 'clipped'>> {
    if (!FFMPEG) throw new MediaFailure('unreadable', 'no ffmpeg binary for this platform');
    const dir = await mkdtemp(join(tmpdir(), 'voice-'));
    try {
      const input = join(dir, 'source');
      await downloadToFile(source, input, { maxBytes: MAX_SOURCE_BYTES, timeoutMs: DOWNLOAD_TIMEOUT_MS });
      const relative = join(FOLDER, tenantId, `${randomUUID()}.mp3`);
      const output = join(uploadsRoot(), relative);
      await mkdir(dirname(output), { recursive: true });
      // ffmpeg's report on stderr names the source's streams and length.
      const run = await this.converting.run(() =>
        runFfmpeg(
          ['-hide_banner', '-nostats', ...INPUT_LIMITS, '-i', input, '-t', String(MAX_VOICE_SECONDS), '-vn', '-map_metadata', '-1',
            '-ac', '1', '-ar', '16000', '-c:a', 'libmp3lame', '-b:a', '48k', '-f', 'mp3', '-y', output],
          CONVERT_TIMEOUT_MS,
        ),
      );
      const size = await stat(output).then((s) => s.size).catch(() => 0);
      if (run.code !== 0 || size === 0 || !/Stream #.*Audio:/.test(run.stderr)) {
        await rm(output, { force: true });
        throw new MediaFailure('unreadable', `ffmpeg exited ${run.code}: ${run.stderr.slice(-200)}`);
      }
      const duration = parseDuration(run.stderr);
      return {
        url: `/uploads/${relative.split('\\').join('/')}`,
        ...(duration !== null && { seconds: Math.round(Math.min(duration, MAX_VOICE_SECONDS)) }),
        ...(duration !== null && duration > MAX_VOICE_SECONDS && { clipped: true }),
      };
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  /** The words in an MP3. Overridden in tests. */
  protected async transcribe(audio: Buffer): Promise<{ text: string; model: string }> {
    const openai = this.provider();
    if (!openai) throw new Error('OPENAI_API_KEY is not set');
    const model = this.config.get<string>('voice.transcribeModel') || DEFAULT_TRANSCRIBE_MODEL;
    const result = await transcribe({
      model: openai.transcription(model),
      audio,
      maxRetries: 1,
      abortSignal: AbortSignal.timeout(TRANSCRIBE_TIMEOUT_MS),
      providerOptions: { openai: { prompt: VOCABULARY_HINT } },
    });
    return { text: result.text.replace(/\s+/g, ' ').trim(), model };
  }

  private provider(): OpenAIProvider | null {
    if (this.openai) return this.openai;
    const apiKey = this.config.get<string>('openai.apiKey');
    if (!apiKey) return null;
    this.openai = createOpenAI({ apiKey });
    return this.openai;
  }

  /** One attachment replaced in place, so a photo or story copy written meanwhile stays. */
  private async write(messageId: string, index: number, attachment: MessageAttachment): Promise<void> {
    await this.dataSource.query(
      `UPDATE messages SET attachments = jsonb_set(attachments, ARRAY[$2::text], $3::jsonb)
        WHERE id = $1 AND jsonb_typeof(attachments) = 'array'`,
      [messageId, String(index), JSON.stringify(attachment)],
    );
  }

  private track(conversationId: string, task: Promise<void>): void {
    const tasks = this.pending.get(conversationId) ?? new Set<Promise<void>>();
    this.pending.set(conversationId, tasks);
    const tracked = withDeadline(task, TRACK_TIMEOUT_MS, undefined).finally(() => {
      tasks.delete(tracked);
      if (tasks.size === 0 && this.pending.get(conversationId) === tasks) this.pending.delete(conversationId);
    });
    tasks.add(tracked);
  }

  /** Tried within ATTEMPT_MEMORY_MS. An older entry is forgotten here, so it never blocks a retry. */
  private triedRecently(key: string): boolean {
    const at = this.attempted.get(key);
    if (at === undefined) return false;
    if (Date.now() - at <= ATTEMPT_MEMORY_MS) return true;
    this.attempted.delete(key);
    return false;
  }

  private remember(key: string): void {
    const now = Date.now();
    for (const [k, at] of this.attempted) {
      if (now - at > ATTEMPT_MEMORY_MS) this.attempted.delete(k);
      else break; // insertion order: the rest are newer
    }
    this.attempted.set(key, now);
  }
}

function withDeadline<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<T>((resolve) => {
    // Unref'd: a transcription that hangs never keeps the process alive.
    timer = setTimeout(() => resolve(fallback), ms);
    timer.unref?.();
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

/** Only the fields that are set, so the result never blanks the attachment's own. */
function defined(result: VoiceResult): VoiceResult {
  return Object.fromEntries(Object.entries(result).filter(([, v]) => v !== undefined)) as VoiceResult;
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
