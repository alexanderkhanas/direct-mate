import { Injectable, Logger, OnModuleDestroy, OnModuleInit, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, LessThanOrEqual, Repository } from 'typeorm';
import * as crypto from 'crypto';
import { ConnectionType, ConversationStatus, MessageRole } from '@direct-mate/shared';
import { ConversationsService } from '../../conversations/conversations.service';
import { Conversation } from '../../conversations/entities/conversation.entity';
import type { MessageAttachment } from '../../conversations/entities/message.entity';
import { TurnRunner, TurnRunResult } from '../../conversations/turn-runner.service';
import { AgentStoreSettingsService } from '../../agent/store-settings.service';
import { CustomerMediaService } from '../../customer-media/customer-media.service';
import { IntegrationsService } from '../../integrations/integrations.service';
import { Connection } from '../../integrations/entities/connection.entity';
import { TelegramService } from '../../notifications/telegram.service';
import { LearningObserverService } from '../../screenshot-training/learning-observer.service';
import { CryptoService } from '../../../common/crypto.service';
import { returnedRows } from '../../../common/db';
import { GRAPH_API } from '../../../common/meta-graph';
import { InstagramCommentService } from './instagram-comment.service';
import { InstagramSender, splitForInstagram } from './instagram-sender.service';

interface MetaAttachment {
  type: string;
  payload?: { url?: string; ig_post_media_id?: string; reel_video_id?: string; title?: string };
}

interface MetaMessagingEvent {
  sender?: { id: string };
  recipient?: { id: string };
  message?: {
    mid: string;
    text?: string;
    is_echo?: boolean;
    /** Set on echoes of messages an app sent; compared with our META_APP_ID. */
    app_id?: string | number;
    reply_to?: { mid?: string; story?: { id: string; url?: string } };
    attachments?: MetaAttachment[];
  };
  message_edit?: { mid: string; num_edit: number };
  timestamp: number;
}

// Comment webhook payload (field-based change, not a messaging event).
// Arrives under entry[].changes when someone comments on a post/reel.
export interface CommentChangeValue {
  from?: { id: string; username?: string };
  media?: { id: string; media_product_type?: string };
  id: string; // the comment id
  parent_id?: string;
  text?: string;
}

interface MetaWebhookChange {
  field: string;
  value: CommentChangeValue;
}

interface MetaMessagingEntry {
  id?: string;
  time?: number;
  messaging?: MetaMessagingEvent[];
  changes?: MetaWebhookChange[];
}

interface MetaWebhookPayload {
  object: string;
  entry: MetaMessagingEntry[];
}

interface DueConversation {
  id: string;
  tenant_id: string;
  customer_id: string;
  channel_account_id: string | null;
  reply_rerun: boolean;
}

const POLL_MS = 1_000;
/** Conversations answered at once; more wait for the next poll. */
const MAX_CONCURRENT_RUNS = 10;
/** A run that found the conversation leased tries again this much later. */
const BUSY_RETRY_SECONDS = 2;
/** Images sent with one reply: each is its own DM, so a product list shouldn't arrive as N notifications. */
const MAX_IMAGES_PER_MESSAGE = 4;
/** An echo whose id we don't know yet is checked again after this, in case our send response is still in flight. */
const ECHO_RECHECK_MS = 3_000;
const PRUNE_EVERY_MS = 60 * 60 * 1000;
/** Attachment types that are a reaction, not a message: nothing to answer. */
const IGNORED_ATTACHMENTS = new Set(['like_heart', 'reaction']);

/**
 * Instagram DMs on the v2 agent (implementation plan, Phase 4).
 *
 * - **Intake.** Each webhook message is saved once: a redelivered `mid` is
 *   dropped by the unique index. Every attachment is recorded, and photos are
 *   copied (Instagram's links expire). Then the conversation's reply timer
 *   (`reply_due_at`) is pushed out by the debounce window.
 * - **Answering.** A poller claims due conversations with one atomic UPDATE
 *   and runs each through the TurnRunner: live for active stores, dry run for
 *   learning ones. A run dropped because the customer wrote again is re-run
 *   once with everything; that re-run sends what it writes.
 * - **Delivery.** Messages go out in order (photos before the reply text);
 *   every id Meta returns is recorded. A text that can't be sent is marked
 *   failed, left out of the agent's history, and handed to a manager.
 * - **Echoes.** Instagram echoes every message the account sends. Ours are
 *   recognised by id (or app id, or the text of a reply we just sent); any
 *   other is a manager writing from the Instagram app, which pauses the bot.
 */
@Injectable()
export class InstagramService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(InstagramService.name);
  private pollInterval: ReturnType<typeof setInterval> | null = null;
  private polling = false;
  private readonly running = new Set<string>();
  /** Webhook messages from one sender are saved in arrival order, so a burst doesn't open two conversations. */
  private readonly intakeQueues = new Map<string, Promise<void>>();
  private lastPrune = 0;

  constructor(
    private readonly config: ConfigService,
    private readonly conversationsService: ConversationsService,
    private readonly integrationsService: IntegrationsService,
    private readonly cryptoService: CryptoService,
    private readonly telegramService: TelegramService,
    @InjectRepository(Conversation)
    private readonly conversationRepo: Repository<Conversation>,
    private readonly learningObserver: LearningObserverService,
    private readonly commentService: InstagramCommentService,
    private readonly dataSource: DataSource,
    private readonly turnRunner: TurnRunner,
    private readonly storeSettings: AgentStoreSettingsService,
    private readonly media: CustomerMediaService,
    private readonly sender: InstagramSender,
  ) {}

  async onModuleInit(): Promise<void> {
    // Recover auto-resume: release overdue conversations, keep future ones
    await this.autoResumeExpired();
    this.pollInterval = setInterval(() => void this.poll(), POLL_MS);
  }

  onModuleDestroy(): void {
    if (this.pollInterval) clearInterval(this.pollInterval);
  }

  verifySignature(rawBody: Buffer, signature: string): boolean {
    const appSecret = this.config.get<string>('meta.appSecret') ?? '';
    if (!appSecret) {
      this.logger.error('META_APP_SECRET is not configured — rejecting webhook');
      return false;
    }
    const expected = `sha256=${crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex')}`;
    const given = Buffer.from(signature);
    const wanted = Buffer.from(expected);
    return given.length === wanted.length && crypto.timingSafeEqual(given, wanted);
  }

  verifyWebhook(mode: string, token: string, challenge: string): string {
    const verifyToken = this.config.get<string>('meta.webhookVerifyToken') ?? '';
    if (mode === 'subscribe' && token === verifyToken) {
      return challenge;
    }
    throw new UnauthorizedException('Webhook verification failed');
  }

  // ─── Webhook ────────────────────────────────────────────────────

  async handleWebhook(payload: MetaWebhookPayload): Promise<void> {
    if (payload.object !== 'instagram') return;

    for (const entry of payload.entry) {
      const entryId = entry.id ?? '';

      for (const messaging of entry.messaging ?? []) {
        const message = messaging.message;
        if (message?.is_echo) {
          // Not awaited: an unknown echo waits a few seconds before it is judged.
          this.handleEcho(messaging, entryId).catch((err) =>
            this.logger.error(`Echo handling failed: ${(err as Error).message}`),
          );
          continue;
        }

        if (message && messaging.sender && messaging.recipient) {
          const senderId = messaging.sender.id;
          const recipientId = messaging.recipient.id;
          this.enqueueIntake(`${senderId}:${recipientId}`, () =>
            this.ingest({ senderId, recipientId, mid: message.mid, text: message.text ?? '', message }),
          );
          continue;
        }

        // message_edit with num_edit=0 is a new message in dev mode (no text in payload)
        if (messaging.message_edit && messaging.message_edit.num_edit === 0) {
          await this.ingestEditedMessage(entryId, messaging.message_edit.mid);
        }
      }

      // Field-based changes (comments). Fire-and-forget per change: one bad
      // comment must never abort the rest of the batch.
      for (const change of entry.changes ?? []) {
        if (change.field !== 'comments') continue;
        this.commentService
          .handleComment(entryId, change.value)
          .catch((err) => this.logger.error('handleComment failed', (err as Error).message));
      }
    }
  }

  private enqueueIntake(key: string, task: () => Promise<void>): void {
    const previous = this.intakeQueues.get(key) ?? Promise.resolve();
    const next = previous
      .then(task)
      .catch((err) => this.logger.error(`Intake failed for ${key}: ${(err as Error).message}`))
      .finally(() => {
        if (this.intakeQueues.get(key) === next) this.intakeQueues.delete(key);
      });
    this.intakeQueues.set(key, next);
  }

  // ─── Intake ─────────────────────────────────────────────────────

  private async ingest(params: {
    senderId: string;
    recipientId: string;
    mid: string;
    text: string;
    message?: MetaMessagingEvent['message'];
  }): Promise<void> {
    const connection = await this.integrationsService.findByExternalAccountId(
      params.recipientId,
      ConnectionType.Instagram,
    );
    if (!connection) {
      // Sender and recipient swapped means we are the sender: our own outbound message.
      const own = await this.integrationsService.findByExternalAccountId(params.senderId, ConnectionType.Instagram);
      if (!own) this.logger.warn(`No connected Instagram account for ${params.recipientId} — skipping`);
      return;
    }
    const tenantId = connection.tenantId;

    const attachments = await this.parseAttachments(tenantId, params.message);
    const text = params.text.trim();
    if (!text && attachments.length === 0) return;

    const customer = await this.conversationsService.findOrCreateCustomer(tenantId, 'instagram', params.senderId);
    if (!customer.username) await this.fetchProfile(connection, customer.id, params.senderId);
    const { conversation } = await this.conversationsService.findOrCreateConversation(
      tenantId,
      customer.id,
      'instagram',
      params.recipientId,
    );

    const messageId = await this.conversationsService.saveChannelMessage(
      conversation.id,
      tenantId,
      MessageRole.User,
      text,
      params.mid,
      attachments.length > 0 ? attachments : null,
    );
    if (!messageId) {
      this.logger.log(`Duplicate delivery of ${params.mid} dropped`);
      return;
    }

    // Copy photos before arming the timer, so the agent never runs without them.
    if (attachments.some((a) => a.type === 'customer_photo' && !a.url && !a.error)) {
      const stored = await Promise.all(
        attachments.map((a) => (a.type === 'customer_photo' && !a.url && !a.error ? this.media.attachmentFor(tenantId, a) : a)),
      );
      await this.dataSource.query(`UPDATE messages SET attachments = $1 WHERE id = $2`, [
        JSON.stringify(stored),
        messageId,
      ]);
    }

    const settings = await this.storeSettings.load(tenantId);
    if (settings.operatingMode === 'learning' && text) {
      this.learningObserver.recordCustomerMessage(conversation.id, text);
    }

    const debounceMs = this.config.get<number>('instagram.debounceMs') ?? 5000;
    await this.dataSource.query(
      `UPDATE conversations SET reply_due_at = now() + make_interval(secs => $2) WHERE id = $1`,
      [conversation.id, debounceMs / 1000],
    );
  }

  /** What a message carried besides text. Photos are recorded here and copied after the row is saved. */
  private async parseAttachments(
    tenantId: string,
    message: MetaMessagingEvent['message'] | undefined,
  ): Promise<MessageAttachment[]> {
    if (!message) return [];
    const out: MessageAttachment[] = [];

    if (message.reply_to?.story?.id) {
      out.push({ type: 'story_reply', mediaId: message.reply_to.story.id });
    } else if (message.reply_to?.mid) {
      // A quote-reply to an earlier message in the thread (not a post).
      const quoted = await this.sender.messageText(tenantId, message.reply_to.mid).catch(() => null);
      out.push({ type: 'quoted_message', mediaId: message.reply_to.mid, ...(quoted && { quotedText: quoted }) });
    }

    for (const a of message.attachments ?? []) {
      if (IGNORED_ATTACHMENTS.has(a.type)) continue;
      const url = a.payload?.url;
      switch (a.type) {
        case 'image':
        case 'animated_image':
          out.push(url ? { type: 'customer_photo', mediaId: url } : { type: 'customer_photo', mediaId: 'unknown', error: 'download_failed' });
          break;
        case 'video':
          out.push({ type: 'customer_video', mediaId: url ?? 'unknown' });
          break;
        case 'audio':
          out.push({ type: 'customer_audio', mediaId: url ?? 'unknown' });
          break;
        case 'share':
        case 'ig_post':
          out.push({ type: 'post_share', mediaId: a.payload?.ig_post_media_id ?? url ?? 'unknown' });
          break;
        case 'ig_reel':
        case 'reel':
          out.push({ type: 'post_share', mediaId: a.payload?.reel_video_id ?? a.payload?.ig_post_media_id ?? url ?? 'unknown' });
          break;
        case 'story_mention':
          out.push({ type: 'story_mention', mediaId: url ?? 'unknown' });
          break;
        default:
          this.logger.warn(`Unrecognised Instagram attachment type "${a.type}" — recorded as a file`);
          out.push({ type: 'customer_file', mediaId: url ?? a.type });
      }
    }
    return out;
  }

  /** Dev-mode quirk: a new message arrives as message_edit with no text, so it is fetched. */
  private async ingestEditedMessage(entryId: string, mid: string): Promise<void> {
    const connection = await this.integrationsService.findByExternalAccountId(entryId, ConnectionType.Instagram);
    if (!connection?.accessTokenEncrypted) return;
    const token = this.cryptoService.decrypt(connection.accessTokenEncrypted);
    try {
      const res = await fetch(`${GRAPH_API}/${mid}?fields=from,to,message`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        this.logger.warn(`Failed to fetch message ${mid}: ${res.status} - ${await res.text()}`);
        return;
      }
      const data = (await res.json()) as { from?: { id: string }; to?: { data?: Array<{ id: string }> }; message?: string };
      const senderId = data.from?.id;
      const recipientId = data.to?.data?.[0]?.id;
      if (!data.message || !senderId || !recipientId) return;
      if (senderId === entryId || senderId === connection.externalAccountId) return; // our own message
      this.enqueueIntake(`${senderId}:${recipientId}`, () =>
        this.ingest({ senderId, recipientId, mid, text: data.message! }),
      );
    } catch (err) {
      this.logger.error(`Error fetching message ${mid}: ${(err as Error).message}`);
    }
  }

  /** The customer's Instagram username and name, once. Never fails intake. */
  private async fetchProfile(connection: Connection, customerId: string, igUserId: string): Promise<void> {
    if (!connection.accessTokenEncrypted) return;
    try {
      const token = this.cryptoService.decrypt(connection.accessTokenEncrypted);
      const res = await fetch(`${GRAPH_API}/${igUserId}?fields=username,name`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const profile = (await res.json()) as { username?: string; name?: string };
      await this.conversationsService.updateCustomer(customerId, {
        username: profile.username ?? null,
        fullName: profile.name ?? null,
      });
    } catch {
      // Non-critical — continue without username
    }
  }

  // ─── Answering ──────────────────────────────────────────────────

  private async poll(): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    try {
      await this.answerDue();
      await this.autoResumeExpired();
      if (Date.now() - this.lastPrune > PRUNE_EVERY_MS) {
        this.lastPrune = Date.now();
        await this.sender.pruneSentIds();
      }
    } catch (err) {
      this.logger.error(`Poll failed: ${(err as Error).message}`);
    } finally {
      this.polling = false;
    }
  }

  /** Claim conversations whose reply is due — atomically, so no two pollers answer one — and answer each. */
  private async answerDue(): Promise<void> {
    const capacity = MAX_CONCURRENT_RUNS - this.running.size;
    if (capacity <= 0) return;
    const due = returnedRows<DueConversation>(
      await this.dataSource.query(
        `UPDATE conversations SET reply_due_at = NULL
          WHERE id IN (
            SELECT id FROM conversations
             WHERE reply_due_at <= now()
             ORDER BY reply_due_at
             LIMIT $1
             FOR UPDATE SKIP LOCKED)
          RETURNING id, tenant_id, customer_id, channel_account_id, reply_rerun`,
        [capacity],
      ),
    );
    for (const conversation of due) {
      this.running.add(conversation.id);
      void this.answer(conversation).finally(() => this.running.delete(conversation.id));
    }
  }

  private async answer(conversation: DueConversation): Promise<void> {
    try {
      const settings = await this.storeSettings.load(conversation.tenant_id);
      const learning = settings.operatingMode === 'learning';
      const result = await this.turnRunner.run({
        tenantId: conversation.tenant_id,
        conversationId: conversation.id,
        mode: learning ? 'dry_run' : 'live',
        source: learning ? 'instagram_dry_run' : 'instagram',
        supersede: !learning && !conversation.reply_rerun,
      });

      if (result.status === 'busy') {
        await this.dataSource.query(
          `UPDATE conversations SET reply_due_at = COALESCE(reply_due_at, now() + make_interval(secs => $2)) WHERE id = $1`,
          [conversation.id, BUSY_RETRY_SECONDS],
        );
        return;
      }
      if (result.status === 'superseded') {
        // The new message armed the timer already; COALESCE covers a race where it didn't.
        await this.dataSource.query(
          `UPDATE conversations SET reply_rerun = true, reply_due_at = COALESCE(reply_due_at, now()) WHERE id = $1`,
          [conversation.id],
        );
        return;
      }
      if (conversation.reply_rerun) {
        await this.dataSource.query(`UPDATE conversations SET reply_rerun = false WHERE id = $1`, [conversation.id]);
      }

      if (learning) {
        this.recordLearning(conversation.id, result);
        return;
      }
      if (result.messages.length > 0) await this.deliver(conversation, result);
    } catch (err) {
      this.logger.error(`Answering conversation ${conversation.id} failed: ${(err as Error).message}`);
    }
  }

  /**
   * Send the runner's messages in order. Photos are best-effort and go before
   * the text they illustrate; a text that fails after retries stops the rest,
   * is marked failed, and hands the conversation to a manager.
   */
  private async deliver(conversation: DueConversation, result: TurnRunResult): Promise<void> {
    const connection = conversation.channel_account_id
      ? await this.integrationsService.findByExternalAccountId(conversation.channel_account_id, ConnectionType.Instagram)
      : null;
    const [customer]: Array<{ external_user_id: string }> = await this.dataSource.query(
      `SELECT external_user_id FROM customers WHERE id = $1`,
      [conversation.customer_id],
    );
    const ids = result.messages.map((m) => m.messageId).filter((id): id is string => !!id);
    if (!connection?.accessTokenEncrypted || !connection.externalAccountId || !customer) {
      this.logger.error(`Cannot send to Instagram for conversation ${conversation.id}: no connection token or customer`);
      await this.markFailed(ids);
      return;
    }
    const account = {
      token: this.cryptoService.decrypt(connection.accessTokenEncrypted),
      igAccountId: connection.externalAccountId,
    };
    const recipient = { id: customer.external_user_id };

    for (const [i, message] of result.messages.entries()) {
      const ctx = { tenantId: conversation.tenant_id, conversationId: conversation.id, messageId: message.messageId ?? null };
      for (const url of (message.imageUrls ?? []).slice(0, MAX_IMAGES_PER_MESSAGE)) {
        await this.sender
          .sendImage(account, recipient, url, ctx)
          .catch((err) => this.logger.warn(`Image not delivered (text still goes) for ${conversation.id}: ${(err as Error).message}`));
      }
      try {
        const mids = await this.sender.sendText(account, recipient, message.text, ctx);
        if (message.messageId) {
          await this.dataSource.query(
            `UPDATE messages SET delivery_status = 'sent', external_message_id = COALESCE(external_message_id, $2) WHERE id = $1`,
            [message.messageId, mids[0] ?? null],
          );
        }
      } catch (err) {
        this.logger.error(`Sending to Instagram failed for conversation ${conversation.id}: ${(err as Error).message}`);
        await this.markFailed(result.messages.slice(i).flatMap((m) => (m.messageId ? [m.messageId] : [])));
        if (!result.handoff) await this.handOffUndelivered(conversation, message.text);
        return;
      }
    }
  }

  private async markFailed(messageIds: string[]): Promise<void> {
    if (messageIds.length === 0) return;
    await this.dataSource.query(`UPDATE messages SET delivery_status = 'failed' WHERE id = ANY($1)`, [messageIds]);
  }

  private async handOffUndelivered(conversation: DueConversation, text: string): Promise<void> {
    await this.conversationsService.escalate(conversation.id, 'send_failed');
    const [customer]: Array<{ full_name: string | null; username: string | null }> = await this.dataSource.query(
      `SELECT full_name, username FROM customers WHERE id = $1`,
      [conversation.customer_id],
    );
    await this.telegramService.notifyHandoff({
      tenantId: conversation.tenant_id,
      customerName: customer?.username ? `@${customer.username}` : customer?.full_name || 'Клієнт',
      reason: 'send_failed',
      conversationId: conversation.id,
      lastMessage: '',
      summary: `Бот не зміг надіслати відповідь в Instagram: «${text.slice(0, 300)}»`,
    });
  }

  private recordLearning(conversationId: string, result: TurnRunResult): void {
    const reply = result.messages.filter((m) => m.kind === 'reply').map((m) => m.text).join('\n') || null;
    const tools = [...new Set((result.agent?.steps ?? []).flatMap((s) => s.toolCalls.map((c) => c.toolName)))];
    this.learningObserver.recordBotAnalysis(conversationId, {
      classification: null,
      botReply: reply ?? (result.handoff ? `[handoff: ${result.handoff.reason}]` : null),
      templateScenario: result.handoff ? 'handoff' : tools.join(', ') || null,
    });
  }

  // ─── Echoes and manager replies ─────────────────────────────────

  /**
   * Instagram echoes every message the shop's account sends. Ours are known
   * by id; Meta's app id, when the echo carries one, and the text of a reply
   * we sent in the last two minutes cover an echo that beats our send
   * response. Anything else is a manager writing from the Instagram app.
   */
  private async handleEcho(messaging: MetaMessagingEvent, entryId: string): Promise<void> {
    const message = messaging.message!;
    if (await this.sender.isOwnMessage(message.mid)) return;
    const appId = this.config.get<string>('meta.appId');
    if (message.app_id != null && appId && String(message.app_id) === appId) return;

    const customerIgId = messaging.recipient?.id;
    if (!customerIgId) return;
    const connection = await this.integrationsService.findByExternalAccountId(entryId, ConnectionType.Instagram);
    if (!connection) return;
    const customer = await this.conversationsService.findCustomer(connection.tenantId, 'instagram', customerIgId);
    if (!customer) return;
    const conversation = await this.conversationsService.findConversationByCustomer(
      connection.tenantId,
      customer.id,
      'instagram',
      entryId,
    );
    if (!conversation) return;

    const text = message.text?.trim() ?? '';
    if (text && (await this.matchesRecentBotText(conversation.id, text))) return;
    await new Promise((r) => setTimeout(r, ECHO_RECHECK_MS));
    if (await this.sender.isOwnMessage(message.mid)) return;

    await this.handleManagerReply(connection.tenantId, conversation, message.mid, text, message);
  }

  /** The echo's text equals a message (or one of its Instagram-sized parts) the bot sent here just now. */
  private async matchesRecentBotText(conversationId: string, text: string): Promise<boolean> {
    const rows: Array<{ text: string | null }> = await this.dataSource.query(
      `SELECT text FROM messages
        WHERE conversation_id = $1 AND role = $2 AND created_at > now() - interval '2 minutes'`,
      [conversationId, MessageRole.Assistant],
    );
    return rows.some((r) => r.text && splitForInstagram(r.text).some((part) => part === text));
  }

  private async handleManagerReply(
    tenantId: string,
    conversation: Conversation,
    mid: string,
    text: string,
    message: MetaMessagingEvent['message'],
  ): Promise<void> {
    const attachments = await this.parseAttachments(tenantId, message);
    if (!text && attachments.length === 0) return;
    const saved = await this.conversationsService.saveChannelMessage(
      conversation.id,
      tenantId,
      MessageRole.Manager,
      text,
      mid,
      attachments.length > 0 ? attachments : null,
    );
    if (!saved) return; // a redelivered echo

    const settings = await this.storeSettings.load(tenantId);
    if (settings.operatingMode === 'learning' && text) {
      await this.learningObserver.recordManagerReply(tenantId, conversation.id, text);
    }

    if (conversation.status !== ConversationStatus.HumanInControl) {
      await this.conversationsService.takeover(conversation.id, null, 'auto_detected');
      this.logger.log(`Manager reply detected → conversation ${conversation.id} set to human_in_control`);
    }
    await this.setAutoResumeDeadline(conversation.id);
  }

  private async autoResumeExpired(): Promise<void> {
    const expired = await this.conversationRepo.find({
      where: { status: ConversationStatus.HumanInControl, autoResumeAt: LessThanOrEqual(new Date()) },
    });
    for (const conv of expired) {
      try {
        await this.conversationsService.release(conv.id);
        await this.conversationRepo.update(conv.id, { autoResumeAt: null });
        this.logger.log(`Auto-resumed conversation ${conv.id} after timeout`);
      } catch (err) {
        this.logger.error(`Auto-resume failed for ${conv.id}`, err);
      }
    }
  }

  private async setAutoResumeDeadline(conversationId: string, delayMs = 30 * 60 * 1000): Promise<void> {
    const autoResumeAt = new Date(Date.now() + delayMs);
    await this.conversationRepo.update(conversationId, { autoResumeAt });
    this.logger.log(`Auto-resume set for ${conversationId} at ${autoResumeAt.toISOString()}`);
  }
}
