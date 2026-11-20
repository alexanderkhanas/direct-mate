import { MediaFailure } from './customer-media.service';
import { VoiceMessagesService, VoiceResult } from './voice-messages.service';
import type { MessageAttachment } from '../conversations/entities/message.entity';

jest.mock('fs/promises', () => ({ ...jest.requireActual('fs/promises'), readFile: jest.fn(async () => Buffer.from('mp3')) }));

const SOURCE = 'https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=1';
const COPY = { url: '/uploads/customer-media/t1/v.mp3', seconds: 4 };
const audio = (extra: Partial<MessageAttachment> = {}): MessageAttachment => ({ type: 'customer_audio', mediaId: SOURCE, ...extra });

/** The service with its download/convert and its model call replaced. */
class TestVoice extends VoiceMessagesService {
  copies = 0;
  transcriptions = 0;
  copyResult: Pick<VoiceResult, 'url' | 'seconds' | 'clipped'> | Error = COPY;
  transcript: string | Error | Promise<string> = 'Чорні штани в L є?';
  protected async copy(): Promise<Pick<VoiceResult, 'url' | 'seconds' | 'clipped'>> {
    this.copies++;
    if (this.copyResult instanceof Error) throw this.copyResult;
    return this.copyResult;
  }
  protected async transcribe(): Promise<{ text: string; model: string }> {
    this.transcriptions++;
    const text = await this.transcript;
    if (text instanceof Error) throw text;
    return { text, model: 'gpt-4o-mini-transcribe' };
  }
}

function setup(rows: Array<{ id: string; attachments: MessageAttachment[] }> = []) {
  const writes: Array<{ messageId: string; index: string; attachment: MessageAttachment }> = [];
  const dataSource = {
    query: jest.fn(async (sql: string, params: unknown[]) => {
      if (sql.startsWith('SELECT id, attachments FROM messages')) return rows;
      if (sql.includes('jsonb_set')) writes.push({ messageId: params[0] as string, index: params[1] as string, attachment: JSON.parse(params[2] as string) });
      return [];
    }),
  };
  const voice = new TestVoice(dataSource as never, { get: () => undefined } as never);
  return { voice, writes, dataSource };
}

describe('VoiceMessagesService', () => {
  it('writes the copy and the transcript onto that voice message, in its place in the list', async () => {
    const t = setup();
    t.voice.startForMessage('t1', 'c1', 'm1', [{ type: 'customer_photo', mediaId: 'x' }, audio()]);
    await t.voice.prepare('t1', 'c1');

    expect(t.writes).toEqual([
      {
        messageId: 'm1',
        index: '1',
        attachment: { ...audio(), ...COPY, transcript: 'Чорні штани в L є?', transcribedBy: 'gpt-4o-mini-transcribe' },
      },
    ]);
  });

  it('leaves alone what is not a voice message, or was transcribed or failed already', async () => {
    const t = setup();
    t.voice.startForMessage('t1', 'c1', 'm1', [
      { type: 'customer_video', mediaId: SOURCE },
      audio({ transcript: 'Привіт' }),
      audio({ transcript: '' }),
      audio({ error: 'too_large' }),
    ]);
    await t.voice.prepare('t1', 'c1');
    expect(t.voice.copies + t.voice.transcriptions).toBe(0);
    expect(t.writes).toEqual([]);
  });

  it("records why there's no copy, so the agent asks the customer to write", async () => {
    const t = setup();
    t.voice.copyResult = new MediaFailure('too_large', '30 MB');
    t.voice.startForMessage('t1', 'c1', 'm1', [audio(), audio({ mediaId: 'unknown' })]);
    await t.voice.prepare('t1', 'c1');

    expect(t.writes.map((w) => [w.index, w.attachment.error])).toEqual(
      expect.arrayContaining([
        ['0', 'too_large'],
        ['1', 'download_failed'],
      ]),
    );
    expect(t.voice.transcriptions).toBe(0);
  });

  it('keeps the copy when the transcription fails, and transcribes from it next time without downloading again', async () => {
    const t = setup();
    t.voice.transcript = new Error('rate limited');
    t.voice.startForMessage('t1', 'c1', 'm1', [audio()]);
    await t.voice.prepare('t1', 'c1');
    expect(t.writes[0].attachment).toEqual({ ...audio(), ...COPY });

    t.voice.transcript = 'Доставка Новою Поштою';
    expect(await t.voice.process('t1', t.writes[0].attachment)).toEqual({
      ...COPY,
      transcript: 'Доставка Новою Поштою',
      transcribedBy: 'gpt-4o-mini-transcribe',
    });
    expect(t.voice.copies).toBe(1);
  });

  it("starts on the customer's new voice messages before a turn, once, and waits for them", async () => {
    let finish!: (text: string) => void;
    const t = setup([{ id: 'm1', attachments: [audio()] }]);
    t.voice.transcript = new Promise<string>((resolve) => (finish = resolve));

    const waiting = t.voice.prepare('t1', 'c1');
    // Started at intake too: still one transcription.
    t.voice.startForMessage('t1', 'c1', 'm1', [audio()]);
    setTimeout(() => finish('Є в M?'), 10);
    await waiting;

    expect(t.writes).toHaveLength(1);
    expect(t.writes[0].attachment.transcript).toBe('Є в M?');
    expect(t.voice.transcriptions).toBe(1);
    const select = t.dataSource.query.mock.calls[0][0] as string;
    expect(select).toMatch(/attachments @> '\[\{"type": "customer_audio"\}\]'/);
  });

  it('stops waiting at the deadline, and the turn goes on', async () => {
    const t = setup([{ id: 'm1', attachments: [audio()] }]);
    t.voice.transcript = new Promise<string>(() => undefined);
    const started = Date.now();
    await t.voice.prepare('t1', 'c1', 20);
    expect(Date.now() - started).toBeLessThan(1000);
    expect(t.writes).toEqual([]);
  });
});
