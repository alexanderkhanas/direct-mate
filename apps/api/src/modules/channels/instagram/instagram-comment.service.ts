import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { createOpenAI, type OpenAIProvider } from '@ai-sdk/openai';
import { generateText, Output } from 'ai';
import { z } from 'zod';
import { ConnectionType, MessageRole } from '@direct-mate/shared';
import { IntegrationsService } from '../../integrations/integrations.service';
import { InstagramContentService } from './instagram-content.service';
import { ConversationsService } from '../../conversations/conversations.service';
import { TurnRunner, TurnRunResult } from '../../conversations/turn-runner.service';
import { AgentStoreSettingsService } from '../../agent/store-settings.service';
import { CryptoService } from '../../../common/crypto.service';
import { withRetry } from '../../../common/retry';
import { GRAPH_API } from '../../../common/meta-graph';
import { CommentChangeValue } from './instagram.service';
import { InstagramSender } from './instagram-sender.service';

const PUBLIC_REPLY_FALLBACK = 'Відповіли вам у дірект';
/** A conversation already being answered: let the DM poller pick this up shortly. */
const BUSY_RETRY_SECONDS = 2;

/** Told to the agent on a comment turn: the private reply is one text message. */
const COMMENT_NOTE =
  "The customer wrote this as a comment under the shop's post, not in the chat. Your answer goes to them as one " +
  "private message in Direct, and it can't carry photos: don't call show_products or send_size_chart, don't " +
  'mention photos, and keep it to two or three short sentences. They can reply in Direct to continue.';

const GATE_INSTRUCTIONS =
  "You screen comments under an online clothing shop's Instagram posts. Decide whether the comment is a question " +
  'or request the shop should answer in a private message: price, sizes, colours, stock, delivery, payment, how to ' +
  'order, or a request for details («ціна?», «є M?», «+», «хочу», «в директ», «скільки коштує»). Compliments, ' +
  'emojis, tagging friends, discussion between other people, complaints written for an audience, and spam are not.';
const gateSchema = z.object({ answer: z.boolean() });

/**
 * Instagram comments (entry[].changes, field='comments') under a FEED post
 * linked to a product.
 *
 * A small model decides whether the comment asks the shop something. If it
 * does, the comment is saved in the commenter's DM conversation (the same one
 * their direct messages use) and the agent answers it as a normal turn; the
 * reply goes out as a private reply to the comment, the sanctioned way to open
 * a DM from a comment. When they write back in Direct, the agent already has
 * the comment and its answer in the history. A short public reply under the
 * comment then points them to Direct.
 *
 * A private reply is a single message, so it is sent as text only: the agent
 * is told not to show photos, and any it staged are dropped.
 */
@Injectable()
export class InstagramCommentService {
  private readonly logger = new Logger(InstagramCommentService.name);
  private openai: OpenAIProvider | null = null;

  constructor(
    private readonly integrationsService: IntegrationsService,
    private readonly contentService: InstagramContentService,
    private readonly conversationsService: ConversationsService,
    private readonly turnRunner: TurnRunner,
    private readonly storeSettings: AgentStoreSettingsService,
    private readonly cryptoService: CryptoService,
    private readonly sender: InstagramSender,
    private readonly config: ConfigService,
    private readonly dataSource: DataSource,
  ) {}

  async handleComment(entryId: string, value: CommentChangeValue): Promise<void> {
    const commentId = value.id;
    const fromId = value.from?.id;
    const mediaId = value.media?.id;
    const text = value.text?.trim();

    if (!commentId || !fromId || !mediaId || !text) {
      this.logger.debug('Comment ignored: incomplete payload');
      return;
    }
    // Feed posts only (not reels, ads or IGTV).
    if (value.media?.media_product_type && value.media.media_product_type !== 'FEED') {
      this.logger.debug(`Comment ignored: media_product_type=${value.media.media_product_type}`);
      return;
    }

    // entry.id is the IG business account; Meta's test payloads send "0", which resolves to nothing.
    const connection = await this.integrationsService.findByExternalAccountId(entryId, ConnectionType.Instagram);
    if (!connection) {
      this.logger.debug(`No connected Instagram account for entry ${entryId} — skipping comment`);
      return;
    }
    const tenantId = connection.tenantId;

    // Our own public reply is itself a comment, and Meta sends it back to us.
    if (connection.externalAccountId && fromId === connection.externalAccountId) {
      this.logger.debug('Comment ignored: authored by the connected account (own reply)');
      return;
    }
    if (!connection.accessTokenEncrypted || !connection.externalAccountId) {
      this.logger.warn(`No access token for connection ${connection.id} — cannot answer comments`);
      return;
    }

    const [storeConfig]: Array<{ flow_config: Record<string, unknown> | null }> = await this.dataSource.query(
      `SELECT flow_config FROM store_configs WHERE tenant_id = $1`,
      [tenantId],
    );
    const commentCfg = (storeConfig?.flow_config?.commentHandling ?? {}) as { enabled?: boolean; publicReply?: string };
    if (commentCfg.enabled === false) {
      this.logger.debug(`Comment handling disabled for tenant ${tenantId}`);
      return;
    }
    const settings = await this.storeSettings.load(tenantId);
    if (settings.operatingMode !== 'active') {
      this.logger.debug(`Comment ignored: store ${tenantId} is ${settings.operatingMode}`);
      return;
    }

    const mapping = await this.contentService.findByMediaId(tenantId, mediaId);
    if (!mapping?.productId) {
      this.logger.debug(`Comment ignored: post ${mediaId} not linked to a product`);
      return;
    }
    if (!(await this.isQuestionForShop(text))) {
      this.logger.log(`Comment ${commentId} ignored: not a question for the shop`);
      return;
    }

    // The commenter's DM conversation: the same keys the DM webhook uses.
    const customer = await this.conversationsService.findOrCreateCustomer(tenantId, 'instagram', fromId);
    if (!customer.username && value.from?.username) {
      await this.conversationsService.updateCustomer(customer.id, { username: value.from.username });
    }
    const { conversation } = await this.conversationsService.findOrCreateConversation(
      tenantId,
      customer.id,
      'instagram',
      connection.externalAccountId,
    );
    // Keyed on the comment id, so Meta's resends are dropped here.
    const messageId = await this.conversationsService.saveChannelMessage(
      conversation.id,
      tenantId,
      MessageRole.User,
      text,
      commentId,
      [{ type: 'post_comment', mediaId }],
    );
    if (!messageId) {
      this.logger.debug(`Comment ${commentId} already handled — skipping`);
      return;
    }

    const result = await this.turnRunner.run({
      tenantId,
      conversationId: conversation.id,
      mode: 'live',
      source: 'instagram',
      notes: [COMMENT_NOTE],
    });
    if (result.status === 'busy') {
      // They are mid-conversation in Direct, so a normal DM reaches them: leave it to the DM poller.
      await this.dataSource.query(
        `UPDATE conversations SET reply_due_at = COALESCE(reply_due_at, now() + make_interval(secs => $2)) WHERE id = $1`,
        [conversation.id, BUSY_RETRY_SECONDS],
      );
      return;
    }
    if (result.messages.length === 0) return;

    const account = {
      token: this.cryptoService.decrypt(connection.accessTokenEncrypted),
      igAccountId: connection.externalAccountId,
    };
    const sent = await this.sendPrivateReply(account, commentId, tenantId, conversation.id, result);
    if (!sent) return;

    const publicText = commentCfg.publicReply?.trim() || PUBLIC_REPLY_FALLBACK;
    await withRetry(() => this.replyToComment(commentId, publicText, account.token), {
      label: `comment-public-reply-${commentId}`,
      maxAttempts: 3,
      baseDelayMs: 2000,
    }).catch((err) => this.logger.error(`Public comment reply failed for ${commentId}: ${(err as Error).message}`));
    this.logger.log(`Answered comment ${commentId} on product ${mapping.productId} (${result.status})`);
  }

  /** Every message the runner produced (welcome, reply, handoff line), as one text. */
  private async sendPrivateReply(
    account: { token: string; igAccountId: string },
    commentId: string,
    tenantId: string,
    conversationId: string,
    result: TurnRunResult,
  ): Promise<boolean> {
    const ids = result.messages.flatMap((m) => (m.messageId ? [m.messageId] : []));
    const replyId = result.messages.find((m) => m.kind === 'reply')?.messageId ?? ids[0] ?? null;
    const text = result.messages.map((m) => m.text).join('\n\n');
    if (result.messages.some((m) => m.imageUrls?.length)) {
      this.logger.warn(`Comment ${commentId}: photos dropped, a private reply is text only`);
    }
    try {
      const mids = await this.sender.sendText(account, { comment_id: commentId }, text, {
        tenantId,
        conversationId,
        messageId: replyId,
      });
      if (ids.length > 0) {
        await this.dataSource.query(`UPDATE messages SET delivery_status = 'sent' WHERE id = ANY($1)`, [ids]);
      }
      if (replyId && mids[0]) {
        await this.dataSource.query(`UPDATE messages SET external_message_id = $2 WHERE id = $1`, [replyId, mids[0]]);
      }
      return true;
    } catch (err) {
      this.logger.error(`Private reply failed for comment ${commentId}: ${(err as Error).message}`);
      if (ids.length > 0) {
        await this.dataSource.query(`UPDATE messages SET delivery_status = 'failed' WHERE id = ANY($1)`, [ids]);
      }
      return false;
    }
  }

  /** Fails closed: a comment we can't screen gets no DM. */
  private async isQuestionForShop(comment: string): Promise<boolean> {
    const openai = this.provider();
    if (!openai) return false;
    try {
      const result = await generateText({
        model: openai(this.config.get<string>('instagram.commentGateModel') ?? 'gpt-5.4-mini'),
        instructions: GATE_INSTRUCTIONS,
        output: Output.object({ schema: gateSchema, name: 'comment_screen' }),
        messages: [{ role: 'user', content: comment.slice(0, 500) }],
        maxRetries: 2,
      });
      return result.output?.answer === true;
    } catch (err) {
      this.logger.warn(`Comment screen failed, comment not answered: ${(err as Error).message}`);
      return false;
    }
  }

  private provider(): OpenAIProvider | null {
    if (this.openai) return this.openai;
    const apiKey = this.config.get<string>('openai.apiKey');
    if (!apiKey) return null;
    this.openai = createOpenAI({ apiKey });
    return this.openai;
  }

  /** Public reply threaded under the comment. */
  private async replyToComment(commentId: string, text: string, token: string): Promise<void> {
    const res = await fetch(`${GRAPH_API}/${commentId}/replies`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ message: text }),
    });
    if (!res.ok) {
      throw new Error(`Comment reply error ${res.status}: ${await res.text()}`);
    }
  }
}
