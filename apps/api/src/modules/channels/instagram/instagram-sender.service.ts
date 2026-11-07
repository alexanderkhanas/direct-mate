import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { withRetry } from '../../../common/retry';
import { GRAPH_API } from '../../../common/meta-graph';

/** Meta's limit for one text message: 1,000 bytes of UTF-8, which is about 500 Cyrillic characters. */
export const IG_TEXT_LIMIT_BYTES = 1000;

export type IgRecipient = { id: string } | { comment_id: string };

/** The connected account a message is sent from: the send path names it, `/me` doesn't. */
export interface IgAccount {
  token: string;
  igAccountId: string;
}

export interface SendContext {
  tenantId: string;
  /** The conversation the message belongs to, for the record of ids we sent. */
  conversationId: string | null;
  /** The saved message row it was sent for, so a quote-reply to it can be resolved. */
  messageId?: string | null;
}

/**
 * Every message we send to Instagram goes through here, so every id Meta
 * returns is recorded in `instagram_sent_mids`. When the echo of that message
 * comes back as a webhook (`is_echo`), `isOwnMessage` recognises it; any echo
 * we didn't send is a manager writing from the Instagram app.
 *
 * A separate provider so the comment flow can use it without depending on
 * `InstagramService`, which depends on the comment flow.
 */
@Injectable()
export class InstagramSender {
  private readonly logger = new Logger(InstagramSender.name);

  constructor(
    private readonly config: ConfigService,
    private readonly dataSource: DataSource,
  ) {}

  /** Sends text, split into as many messages as Meta's limit needs. Returns their ids. Throws after retries. */
  async sendText(account: IgAccount, recipient: IgRecipient, text: string, ctx: SendContext): Promise<string[]> {
    const mids: string[] = [];
    for (const chunk of splitForInstagram(text)) {
      const mid = await withRetry(() => this.post(account, recipient, { text: chunk }, ctx), {
        label: `ig-text-${'id' in recipient ? recipient.id : recipient.comment_id}`,
        maxAttempts: 3,
        baseDelayMs: 2000,
      });
      if (mid) mids.push(mid);
    }
    return mids;
  }

  /**
   * One image per message: the batched `attachments` array was rejected by
   * Meta on every attempt (400 / subcode 2018007). Throws after retries.
   */
  async sendImage(account: IgAccount, recipient: IgRecipient, imageUrl: string, ctx: SendContext): Promise<string | null> {
    const url = this.publicUrl(imageUrl);
    return withRetry(
      () => this.post(account, recipient, { attachment: { type: 'image', payload: { url } } }, ctx),
      { label: `ig-image-${'id' in recipient ? recipient.id : recipient.comment_id}`, maxAttempts: 3, baseDelayMs: 2000 },
    );
  }

  async isOwnMessage(mid: string): Promise<boolean> {
    const rows = await this.dataSource.query(`SELECT 1 FROM instagram_sent_mids WHERE mid = $1`, [mid]);
    return rows.length > 0;
  }

  /** The text of a message in this thread, ours or the customer's, by its Instagram id. */
  async messageText(tenantId: string, mid: string): Promise<string | null> {
    const [row]: Array<{ text: string | null }> = await this.dataSource.query(
      `SELECT m.text FROM instagram_sent_mids s JOIN messages m ON m.id = s.message_id
        WHERE s.mid = $1 AND s.tenant_id = $2
       UNION ALL
       SELECT text FROM messages WHERE tenant_id = $2 AND external_message_id = $1
       LIMIT 1`,
      [mid, tenantId],
    );
    return row?.text?.trim() || null;
  }

  /** Echoes arrive within seconds; quote-replies to old messages are rare. */
  async pruneSentIds(olderThanDays = 30): Promise<void> {
    await this.dataSource.query(
      `DELETE FROM instagram_sent_mids WHERE created_at < now() - make_interval(days => $1)`,
      [olderThanDays],
    );
  }

  /**
   * A path we serve (`/uploads/…`) as a URL Meta can fetch, from `app.baseUrl`.
   * Percent-encoded: seeded file names carry non-ASCII characters
   * (`vʼyazana-…`), and Meta's fetcher is not a browser.
   */
  publicUrl(url: string): string {
    if (/^https?:\/\//i.test(url)) return url;
    const base = (this.config.get<string>('app.baseUrl') ?? '').replace(/\/$/, '');
    if (!base || /^https?:\/\/localhost/i.test(base)) {
      this.logger.warn(`app.baseUrl is "${base || '(unset)'}": Meta can't fetch ${url}. Set APP_BASE_URL to a public URL.`);
    }
    return base ? `${base}/${encodeURI(url.replace(/^\//, ''))}` : url;
  }

  private async post(
    account: IgAccount,
    recipient: IgRecipient,
    message: Record<string, unknown>,
    ctx: SendContext,
  ): Promise<string | null> {
    const res = await fetch(`${GRAPH_API}/${account.igAccountId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${account.token}` },
      body: JSON.stringify({ recipient, message }),
    });
    if (!res.ok) throw new Error(`Meta send error ${res.status}: ${await res.text()}`);
    const body = (await res.json()) as { message_id?: string };
    const mid = body.message_id ?? null;
    if (mid) {
      await this.dataSource
        .query(
          `INSERT INTO instagram_sent_mids (mid, tenant_id, conversation_id, message_id)
           VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
          [mid, ctx.tenantId, ctx.conversationId, ctx.messageId ?? null],
        )
        .catch((err) => this.logger.error(`Could not record sent message id ${mid}: ${err}`));
    }
    return mid;
  }
}

/**
 * Split text into messages of at most `limitBytes` UTF-8 bytes, breaking at a
 * paragraph, then a line, a sentence, a word, and only as a last resort
 * inside a word. Text that fits is returned as is.
 */
export function splitForInstagram(text: string, limitBytes = IG_TEXT_LIMIT_BYTES): string[] {
  const chunks: string[] = [];
  let rest = text.trim();
  while (Buffer.byteLength(rest, 'utf8') > limitBytes) {
    const fit = longestPrefixWithin(rest, limitBytes);
    const window = rest.slice(0, fit);
    const cut = lastBreak(window) ?? fit;
    chunks.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) chunks.push(rest);
  return chunks;
}

function longestPrefixWithin(text: string, limitBytes: number): number {
  let bytes = 0;
  let i = 0;
  for (const ch of text) {
    const size = Buffer.byteLength(ch, 'utf8');
    if (bytes + size > limitBytes) break;
    bytes += size;
    i += ch.length;
  }
  return i;
}

/** Where to cut inside `window`: the end of its last paragraph, line, sentence or word. Null if none is past halfway. */
function lastBreak(window: string): number | null {
  const min = Math.floor(window.length / 2);
  for (const pattern of [/\n\s*\n/g, /\n/g, /[.!?…](?=\s)/g, /\s/g]) {
    let at = -1;
    for (const m of window.matchAll(pattern)) at = m.index! + m[0].length;
    if (at > min) return at;
  }
  return null;
}
