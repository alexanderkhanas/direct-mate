import { Injectable, Logger, OnModuleInit, OnModuleDestroy, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository, LessThanOrEqual } from 'typeorm';
import * as crypto from 'crypto';
import { ConversationsService } from '../../conversations/conversations.service';
import { ReplyEngineService } from '../../conversations/reply-engine.service';
import { IntegrationsService } from '../../integrations/integrations.service';
import { OrdersService } from '../../orders/orders.service';
import { CryptoService } from '../../../common/crypto.service';
import { TelegramService } from '../../notifications/telegram.service';
import { Connection } from '../../integrations/entities/connection.entity';
import { PendingMessage } from './entities/pending-message.entity';
import { Conversation } from '../../conversations/entities/conversation.entity';
import { ConversationState } from '../../conversations/entities/conversation-state.entity';
import { StoreConfig } from '../../engine/entities/store-config.entity';
import { LearningObserverService } from '../../screenshot-training/learning-observer.service';
import { ConnectionType, ConversationStatus, MessageDirection, MessageRole, ReplyDecision } from '@direct-mate/shared';
import { withRetry } from '../../../common/retry';

interface MediaReference {
  mediaId: string;
  type: 'story_reply' | 'post_reply' | 'post_share' | 'customer_photo';
}

interface MetaMessagingEvent {
  sender?: { id: string };
  recipient?: { id: string };
  message?: {
    mid: string;
    text?: string;
    is_echo?: boolean;
    reply_to?: { mid?: string; story?: { id: string } };
    attachments?: Array<{
      type: string;
      payload?: { url?: string; ig_post_media_id?: string; title?: string };
    }>;
  };
  message_edit?: { mid: string; num_edit: number };
  timestamp: number;
}

interface MetaMessagingEntry {
  id?: string;
  time?: number;
  messaging?: MetaMessagingEvent[];
}

interface MetaWebhookPayload {
  object: string;
  entry: MetaMessagingEntry[];
}

const DEBOUNCE_MS = 5_000; // 5 seconds


@Injectable()
export class InstagramService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(InstagramService.name);
  private readonly recentSentMids = new Set<string>();
  // Per-recipient timestamp of our last outbound send. Used to filter out
  // bot's own echoes that arrive before we register the MID (race condition
  // between Meta's fetch response and Meta's echo webhook).
  private readonly recentSendByRecipient = new Map<string, number>();
  private pollInterval: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly conversationsService: ConversationsService,
    private readonly replyEngineService: ReplyEngineService,
    private readonly integrationsService: IntegrationsService,
    private readonly ordersService: OrdersService,
    private readonly cryptoService: CryptoService,
    private readonly telegramService: TelegramService,
    @InjectRepository(PendingMessage)
    private readonly pendingMessageRepo: Repository<PendingMessage>,
    @InjectRepository(Conversation)
    private readonly conversationRepo: Repository<Conversation>,
    @InjectRepository(StoreConfig)
    private readonly storeConfigRepo: Repository<StoreConfig>,
    private readonly learningObserver: LearningObserverService,
    private readonly dataSource: DataSource,
  ) {}

  async onModuleInit(): Promise<void> {
    // Recover auto-resume: release overdue conversations, keep future ones
    const overdue = await this.conversationRepo.find({
      where: {
        status: ConversationStatus.HumanInControl,
        autoResumeAt: LessThanOrEqual(new Date()),
      },
    });
    for (const conv of overdue) {
      await this.conversationsService.release(conv.id);
      await this.conversationRepo.update(conv.id, { autoResumeAt: null });
      this.logger.log(`Startup recovery: auto-resumed conversation ${conv.id}`);
    }

    // Start polling for pending messages (debounce flush) and auto-resume
    this.pollInterval = setInterval(() => this.pollTasks(), 2_000);
  }

  onModuleDestroy(): void {
    if (this.pollInterval) clearInterval(this.pollInterval);
  }

  /** Polls DB for debounce flushes and auto-resume deadlines */
  private async pollTasks(): Promise<void> {
    try {
      await this.flushReadyMessages();
      await this.autoResumeExpired();
    } catch (err) {
      this.logger.error('Poll tasks error', (err as Error).message);
    }
  }

  private async flushReadyMessages(): Promise<void> {
    // Find distinct debounce keys that are ready to flush
    const ready = await this.pendingMessageRepo
      .createQueryBuilder('pm')
      .select('DISTINCT pm.debounce_key', 'debounceKey')
      .where('pm.flush_at <= :now', { now: new Date() })
      .getRawMany<{ debounceKey: string }>();

    for (const { debounceKey } of ready) {
      await this.flushPending(debounceKey);
    }
  }

  private async autoResumeExpired(): Promise<void> {
    const expired = await this.conversationRepo.find({
      where: {
        status: ConversationStatus.HumanInControl,
        autoResumeAt: LessThanOrEqual(new Date()),
      },
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

  private async sendMetaMessage(
    recipientId: string,
    text: string,
    pageAccessToken: string,
  ): Promise<string | null> {
    this.recentSendByRecipient.set(recipientId, Date.now());
    const res = await fetch('https://graph.instagram.com/v21.0/me/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${pageAccessToken}`,
      },
      body: JSON.stringify({
        recipient: { id: recipientId },
        message: { text },
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Meta API error ${res.status}: ${body}`);
    }
    const body = await res.json() as { message_id?: string };
    const mid = body.message_id ?? null;
    if (mid) {
      this.recentSentMids.add(mid);
      setTimeout(() => this.recentSentMids.delete(mid), 5 * 60 * 1000);
    }
    return mid;
  }

  /**
   * Convert a possibly-relative image path to a fully-qualified URL Meta can
   * fetch. Already-absolute http(s) URLs pass through unchanged. Relative
   * paths get the configured `app.baseUrl` prefix (ngrok tunnel in dev,
   * public HTTPS domain in prod). Mirrors `SizeChartsService.publicUrl()` —
   * the size-chart bubble path already does this; product images need it too.
   */
  private toPublicImageUrl(url: string): string {
    if (/^https?:\/\//i.test(url)) return url;
    const base = (this.config.get<string>('app.baseUrl') ?? '').replace(/\/$/, '');
    const clean = url.replace(/^\//, '');
    return base ? `${base}/${clean}` : url;
  }

  private async sendMetaImages(
    recipientId: string,
    imageUrls: string[],
    pageAccessToken: string,
  ): Promise<void> {
    this.recentSendByRecipient.set(recipientId, Date.now());

    // Pre-flight: Meta cannot fetch from localhost/unset hosts. Surface this
    // before burning 3 retries × ~6s of confusing 400s.
    const hasRelative = imageUrls.some((u) => !/^https?:\/\//i.test(u));
    if (hasRelative) {
      const base = this.config.get<string>('app.baseUrl') ?? '';
      if (!base || /^https?:\/\/localhost/i.test(base)) {
        this.logger.warn(
          `app.baseUrl is "${base || '(unset)'}" — Meta cannot fetch attachments. ` +
            `Set APP_BASE_URL to the public ngrok / prod URL.`,
        );
      }
    }

    const absoluteUrls = imageUrls.map((u) => this.toPublicImageUrl(u));
    const res = await fetch('https://graph.instagram.com/v21.0/me/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${pageAccessToken}`,
      },
      body: JSON.stringify({
        recipient: { id: recipientId },
        message: {
          attachments: absoluteUrls.map((url) => ({
            type: 'image',
            payload: { url },
          })),
        },
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Meta API images send error ${res.status}: ${body}`);
    }
    const body = await res.json() as { message_id?: string };
    if (body.message_id) {
      this.recentSentMids.add(body.message_id);
      setTimeout(() => this.recentSentMids.delete(body.message_id!), 5 * 60 * 1000);
    }
  }

  verifySignature(rawBody: Buffer, signature: string): boolean {
    const appSecret = this.config.get<string>('meta.appSecret') ?? '';
    if (!appSecret) {
      this.logger.error('META_APP_SECRET is not configured — rejecting webhook');
      return false;
    }
    const expected = `sha256=${crypto
      .createHmac('sha256', appSecret)
      .update(rawBody)
      .digest('hex')}`;
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  }

  verifyWebhook(mode: string, token: string, challenge: string): string {
    const verifyToken = this.config.get<string>('meta.webhookVerifyToken') ?? '';
    if (mode === 'subscribe' && token === verifyToken) {
      return challenge;
    }
    throw new UnauthorizedException('Webhook verification failed');
  }

  private async fetchMessageFromApi(
    messageId: string,
    accessToken: string,
  ): Promise<{ from: { id: string }; to: { data: Array<{ id: string }> }; message: string } | null> {
    try {
      const res = await fetch(
        `https://graph.instagram.com/v21.0/${messageId}?fields=from,to,message&access_token=${accessToken}`,
      );
      if (!res.ok) {
        const errBody = await res.text();
        this.logger.warn(`Failed to fetch message ${messageId}: ${res.status} - ${errBody}`);
        return null;
      }
      return await res.json() as any;
    } catch (err) {
      this.logger.error(`Error fetching message ${messageId}`, err);
      return null;
    }
  }

  private extractMediaReference(
    message: MetaMessagingEvent['message'],
  ): MediaReference | null {
    if (!message) return null;

    // Story reply: reply_to.story.id
    if (message.reply_to?.story?.id) {
      return { mediaId: message.reply_to.story.id, type: 'story_reply' };
    }

    // Post reply: reply_to.mid (without story)
    if (message.reply_to?.mid) {
      return { mediaId: message.reply_to.mid, type: 'post_reply' };
    }

    // Post share: user shared a product post from the feed.
    // Meta sends attachments[].type='share' or 'ig_post' (newer payload
    // shape) with payload.ig_post_media_id.
    if (message.attachments?.length) {
      const shareAttachment = message.attachments.find(
        (a) => a.type === 'share' || a.type === 'ig_post',
      );
      if (shareAttachment?.payload?.ig_post_media_id) {
        return {
          mediaId: shareAttachment.payload.ig_post_media_id,
          type: 'post_share',
        };
      }

      // Customer photo: attachments with image/video type
      const mediaAttachment = message.attachments.find(
        (a) => a.type === 'image' || a.type === 'video',
      );
      if (mediaAttachment) {
        return {
          mediaId: mediaAttachment.payload?.url ?? 'unknown',
          type: 'customer_photo',
        };
      }

      this.logger.warn(
        `Unrecognized attachment shape: ${JSON.stringify(message.attachments)}`,
      );
    }

    return null;
  }

  async handleWebhook(payload: MetaWebhookPayload): Promise<void> {
    if (payload.object !== 'instagram') return;

    for (const entry of payload.entry) {
      const entryId = entry.id;

      for (const messaging of entry.messaging ?? []) {
        // Debug: log raw messaging event
        this.logger.debug(`Webhook messaging: is_echo=${messaging.message?.is_echo}, sender=${messaging.sender?.id}, text="${messaging.message?.text?.substring(0, 30)}"`);

        // Echo detection — before standard message handling
        if (messaging.message?.is_echo) {
          const mid = messaging.message.mid;
          if (this.recentSentMids.has(mid)) {
            this.recentSentMids.delete(mid);
            continue; // Bot echo, skip
          }
          // Race-condition guard: the echo may arrive before we've registered
          // the MID (Meta fires the webhook in parallel with the HTTP response).
          // If we sent something to this recipient in the last 10s, treat it as
          // our own echo, not a manager reply.
          const recipientId = messaging.recipient?.id;
          if (recipientId) {
            const lastSendTs = this.recentSendByRecipient.get(recipientId);
            if (lastSendTs && Date.now() - lastSendTs < 10_000) {
              this.logger.debug(`Skipping echo within 10s send window for ${recipientId}`);
              continue;
            }
          }
          // Persistent fallback: the in-memory maps clear on restart. Before
          // treating this as a manager reply, check the DB for a recent
          // outbound message to this recipient's conversation. If the bot sent
          // anything in the last 20s, this is almost certainly its own echo.
          if (recipientId) {
            const isOurEcho = await this.hasRecentOutbound(recipientId, 20_000);
            if (isOurEcho) {
              this.logger.debug(
                `Skipping echo: DB shows recent outbound to ${recipientId} (post-restart dedup)`,
              );
              continue;
            }
          }
          // Manager replied in Instagram DMs
          await this.handleManagerReply(messaging, entryId ?? '').catch(err =>
            this.logger.error('handleManagerReply failed', err),
          );
          continue;
        }

        // Standard message event
        if (messaging.message && messaging.sender && messaging.recipient) {
          const mediaRef = this.extractMediaReference(messaging.message);
          const text = messaging.message.text ?? '';
          // Skip if no text AND no media reference
          if (!text && !mediaRef) continue;
          await this.handleIncomingMessage(
            messaging.sender.id,
            messaging.recipient.id,
            messaging.message.mid,
            text,
            mediaRef,
          );
          continue;
        }

        // message_edit with num_edit=0 is a new message in dev mode (no text in payload)
        if (messaging.message_edit && messaging.message_edit.num_edit === 0) {
          this.logger.log(`Received message_edit (num_edit=0), fetching message content...`);

          // Find connection by entry ID (Instagram Business Account ID)
          const connection = await this.integrationsService.findByExternalAccountId(
            entryId ?? '',
            ConnectionType.Instagram,
          );
          if (!connection) {
            this.logger.warn(`No connection for entry id ${entryId}`);
            continue;
          }

          if (!connection.accessTokenEncrypted) {
            this.logger.warn(`No access token for connection ${connection.id}`);
            continue;
          }
          const accessToken = this.cryptoService.decrypt(connection.accessTokenEncrypted);
          const msgData = await this.fetchMessageFromApi(messaging.message_edit.mid, accessToken);
          if (!msgData || !msgData.message) {
            this.logger.warn(`Could not fetch message content for ${messaging.message_edit.mid}`);
            continue;
          }

          const senderId = msgData.from?.id;
          const recipientId = msgData.to?.data?.[0]?.id;

          // Skip messages sent by us (the page/business account)
          if (senderId === entryId || senderId === connection.externalAccountId) {
            this.logger.log(`Skipping own message`);
            continue;
          }

          if (senderId && recipientId) {
            await this.handleIncomingMessage(
              senderId,
              recipientId,
              messaging.message_edit.mid,
              msgData.message,
            );
          }
          continue;
        }
      }
    }
  }

  private async handleIncomingMessage(
    externalUserId: string,
    channelAccountId: string,
    messageId: string,
    messageText: string,
    mediaReference?: MediaReference | null,
  ): Promise<void> {
    // Try to find connection by channelAccountId first, then by any known ID
    let connection = await this.integrationsService.findByExternalAccountId(
      channelAccountId,
      ConnectionType.Instagram,
    );
    if (!connection) {
      // Try sender as the account (in case sender/recipient are swapped)
      connection = await this.integrationsService.findByExternalAccountId(
        externalUserId,
        ConnectionType.Instagram,
      );
      if (connection) {
        // Swap: we are the sender, skip our own messages
        this.logger.log(`Skipping own outbound message`);
        return;
      }
      this.logger.warn(`No connected Instagram account for ${channelAccountId} — skipping`);
      return;
    }

    // Save message immediately to DB
    const customer = await this.conversationsService.findOrCreateCustomer(
      connection.tenantId,
      'instagram',
      externalUserId,
    );

    const { conversation, state } = await this.conversationsService.findOrCreateConversation(
      connection.tenantId,
      customer.id,
      'instagram',
      channelAccountId,
    );

    await this.conversationsService.saveMessage(
      conversation.id,
      connection.tenantId,
      MessageDirection.Inbound,
      MessageRole.User,
      messageText,
      messageId,
    );

    // Learning mode: record customer message immediately (before debounce)
    // so it's in the Map when manager echo arrives (echo has no debounce).
    // Also fire off engine dry-run immediately so bot analysis is ready before manager replies.
    if (messageText) {
      const storeConfig = await this.storeConfigRepo.findOne({ where: { tenantId: connection.tenantId } });
      if (storeConfig?.operatingMode === 'learning') {
        this.learningObserver.recordCustomerMessage(conversation.id, messageText);
        this.runLearningDryRun(connection.tenantId, conversation.id, messageText, state).catch(
          (err: unknown) => this.logger.error(`Learning dry-run failed: ${err}`),
        );
      }
    }

    // Debounce: save to DB, flush when timer expires (polled every 2s)
    const debounceKey = `${externalUserId}:${channelAccountId}`;
    const flushAt = new Date(Date.now() + DEBOUNCE_MS);

    // Update flush_at for all pending messages with this key (extend debounce window)
    await this.pendingMessageRepo
      .createQueryBuilder()
      .update(PendingMessage)
      .set({ flushAt })
      .where('debounce_key = :debounceKey', { debounceKey })
      .execute();

    // Save the new message
    await this.pendingMessageRepo.save({
      debounceKey,
      tenantId: connection.tenantId,
      externalUserId,
      channelAccountId,
      connectionId: connection.id,
      messageId,
      messageText,
      mediaReference: mediaReference as any,
      flushAt,
    });

    this.logger.log(`Debounce: saved message for ${debounceKey}, flush at ${flushAt.toISOString()}`);
  }

  private async flushPending(debounceKey: string): Promise<void> {
    // Atomically grab pending messages for this key
    const messages = await this.pendingMessageRepo.find({
      where: { debounceKey },
      order: { createdAt: 'ASC' },
    });
    if (messages.length === 0) return;

    // Delete immediately to prevent double-processing
    await this.pendingMessageRepo.delete({ debounceKey });

    const combinedText = messages.map((m) => m.messageText).join('\n');
    const mediaRef = messages.find((m) => m.mediaReference)?.mediaReference ?? null;
    const first = messages[0];

    this.logger.log(
      `Debounce: processing ${messages.length} message(s) for ${debounceKey}: "${combinedText.substring(0, 100)}"`,
    );

    // Load connection from DB (not cached in memory)
    const connection = await this.integrationsService.findById(first.connectionId);
    if (!connection) {
      this.logger.warn(`Connection ${first.connectionId} not found during flush — skipping`);
      return;
    }

    try {
      await this.processInbound({
        tenantId: first.tenantId,
        externalUserId: first.externalUserId,
        channelAccountId: first.channelAccountId,
        messageText: combinedText,
        connection,
        mediaReference: mediaRef as MediaReference | null,
      });
    } catch (err) {
      this.logger.error(`Failed to process debounced messages for ${debounceKey}`, err);
    }
  }

  private async processInbound(params: {
    tenantId: string;
    externalUserId: string;
    channelAccountId: string;
    messageText: string;
    connection: Connection;
    mediaReference?: MediaReference | null;
  }): Promise<void> {
    const customer = await this.conversationsService.findOrCreateCustomer(
      params.tenantId,
      'instagram',
      params.externalUserId,
    );

    // One-time fetch of Instagram username if not yet populated
    if (!customer.username && params.connection.accessTokenEncrypted) {
      try {
        const token = this.cryptoService.decrypt(params.connection.accessTokenEncrypted);
        const res = await fetch(
          `https://graph.instagram.com/v21.0/${params.externalUserId}?fields=username,name`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        if (res.ok) {
          const profile = await res.json() as { username?: string; name?: string };
          if (profile.username) customer.username = profile.username;
          if (profile.name) customer.fullName = profile.name;
          await this.conversationsService.updateCustomer(customer.id, {
            username: profile.username ?? null,
            fullName: profile.name ?? null,
          });
        }
      } catch {
        // Non-critical — continue without username
      }
    }

    const { conversation, state } = await this.conversationsService.findOrCreateConversation(
      params.tenantId,
      customer.id,
      'instagram',
      params.channelAccountId,
    );

    // Acquire advisory lock on conversation to prevent concurrent processing
    // Uses a hash of the UUID as the lock key (pg_advisory_xact_lock needs bigint)
    const lockKey = this.conversationLockKey(conversation.id);
    await this.dataSource.query(`SELECT pg_advisory_lock($1)`, [lockKey]);

    try {
      // Re-fetch state inside the lock to get latest version
      const freshState = await this.conversationsService.getState(conversation.id);
      const currentConv = await this.conversationRepo.findOne({ where: { id: conversation.id } });

      // Skip bot processing when manager is in control
      if (currentConv?.status === ConversationStatus.HumanInControl) {
        this.logger.log(`Skipping bot reply — conversation ${conversation.id} is human_in_control`);
        return;
      }

      // Learning mode: dry-run already fired in handleIncomingMessage — just skip reply
      const storeConfig = await this.storeConfigRepo.findOne({ where: { tenantId: params.tenantId } });
      if (storeConfig?.operatingMode === 'learning') {
        return;
      }

      const recentMessages = (
        await this.conversationsService.findById(conversation.id)
      ).messages
        .slice(-10)
        .map((m) => ({ role: m.role, text: m.text }));

      const result = await this.replyEngineService.process({
        tenantId: params.tenantId,
        conversationId: conversation.id,
        messageText: params.messageText,
        state: freshState ?? state,
        recentMessages,
        mediaReference: params.mediaReference ? {
          mediaId: params.mediaReference.mediaId,
          type: params.mediaReference.type,
        } : undefined,
      });

      if (result.stateUpdate) {
        await this.conversationsService.updateState(conversation.id, result.stateUpdate);
      }

    if (result.handoff.required) {
      await this.conversationsService.escalate(
        conversation.id,
        result.handoff.reason ?? 'unknown',
      );

      // Send a natural "checking" message so client doesn't know about handoff
      const handoffMessage = 'Секунду, уточню для вас інформацію 🙏';
      await this.conversationsService.saveMessage(
        conversation.id,
        params.tenantId,
        MessageDirection.Outbound,
        MessageRole.Assistant,
        handoffMessage,
      );
      const encryptedToken = params.connection.accessTokenEncrypted;
      if (encryptedToken) {
        const pageAccessToken = this.cryptoService.decrypt(encryptedToken);
        await this.sendMetaMessage(params.externalUserId, handoffMessage, pageAccessToken).catch((err) => {
          this.logger.error('Failed to send handoff message', err);
        });
      }

      // Notify manager via Telegram (with retry — critical for handoff awareness)
      withRetry(
        () => this.telegramService.notifyHandoff({
          tenantId: params.tenantId,
          customerName: customer.username ? `@${customer.username}` : customer.fullName || params.externalUserId,
          reason: result.handoff.reason ?? 'unknown',
          conversationId: conversation.id,
          lastMessage: params.messageText,
        }),
        { label: `telegram-handoff-${conversation.id}` },
      ).catch(err => this.logger.error('Telegram notification failed after retries', err));

      this.logger.log(`HANDOFF: conversation ${conversation.id}, reason: ${result.handoff.reason}`);
      return;
    }

    // Send reply to customer (common for Reply and CreateDraftOrder)
    if (result.reply?.sendNow && result.reply.text) {
      await this.conversationsService.saveMessage(
        conversation.id,
        params.tenantId,
        MessageDirection.Outbound,
        MessageRole.Assistant,
        result.reply.text,
      );

      const encryptedToken = params.connection.accessTokenEncrypted;
      if (encryptedToken) {
        const pageAccessToken = this.cryptoService.decrypt(encryptedToken);
        try {
          // Send product images as a single batch message before the text
          const replyText = result.reply!.text;
          const replyImages = result.reply!.imageUrls;
          if (replyImages?.length) {
            await withRetry(
              () => this.sendMetaImages(params.externalUserId, replyImages!, pageAccessToken),
              { label: `meta-images-${params.externalUserId}`, maxAttempts: 3, baseDelayMs: 2000 },
            );
            this.logger.log(`Sent ${replyImages.length} product image(s) in one message to ${params.externalUserId}`);
          }

          await withRetry(
            () => this.sendMetaMessage(params.externalUserId, replyText, pageAccessToken),
            { label: `meta-msg-${params.externalUserId}`, maxAttempts: 3, baseDelayMs: 2000 },
          );

          // Iterate any sibling bubbles (size-chart attachment, conversation-
          // start greeting follow-up, future multi-bubble flows). Each extra is
          // sent in the same image-then-text shape as the primary.
          for (const extra of result.extraReplies ?? []) {
            if (extra.imageUrls?.length) {
              await withRetry(
                () => this.sendMetaImages(params.externalUserId, extra.imageUrls!, pageAccessToken),
                { label: `meta-images-extra-${params.externalUserId}`, maxAttempts: 3, baseDelayMs: 2000 },
              );
            }
            if (extra.text) {
              await withRetry(
                () => this.sendMetaMessage(params.externalUserId, extra.text, pageAccessToken),
                { label: `meta-msg-extra-${params.externalUserId}`, maxAttempts: 3, baseDelayMs: 2000 },
              );
            }
          }

          this.logger.log(
            `Delivered ${1 + (result.extraReplies?.length ?? 0)} bubble(s) to ${params.externalUserId} via Meta Graph API`,
          );
        } catch (err) {
          this.logger.error(`Failed to send to Meta API for conversation ${conversation.id}`, err);
          await this.conversationsService.escalate(conversation.id, 'send_failed');
        }
      } else {
        this.logger.warn(`No access token for connection — cannot send message to Meta`);
      }
    }

    // Handle draft order creation
    if (result.decision === ReplyDecision.CreateDraftOrder && result.orderPayload) {
      try {
        // Override customerId with the actual customer from this conversation
        const orderPayload = {
          ...result.orderPayload,
          customerId: customer.id,
        };

        const order = await this.ordersService.createFromConversation(orderPayload);
        this.logger.log(`Order created: ${order.id} for conversation ${conversation.id}`);

        // Trigger external sync (with retry)
        withRetry(
          () => this.ordersService.triggerExternalSync(order),
          { label: `order-sync-${order.id}` },
        ).catch((err) => {
          this.logger.error(
            `External sync trigger failed for order ${order.id} after retries`,
            (err as Error).message,
          );
        });
      } catch (err) {
        this.logger.error(
          `Order creation failed for conversation ${conversation.id}`,
          (err as Error).message,
        );
        // Don't block the conversation — order can be created manually
      }
    }
    } finally {
      await this.dataSource.query(`SELECT pg_advisory_unlock($1)`, [lockKey]);
    }
  }

  private async runLearningDryRun(
    tenantId: string,
    conversationId: string,
    messageText: string,
    state: ConversationState,
  ): Promise<void> {
    const recentMessages = (await this.conversationsService.findById(conversationId)).messages
      .slice(-10)
      .map((m) => ({ role: m.role, text: m.text }));

    const dryRun = await this.replyEngineService.process({
      tenantId,
      conversationId,
      messageText,
      state,
      recentMessages,
    });

    this.learningObserver.recordBotAnalysis(conversationId, {
      classification: dryRun.classification
        ? (dryRun.classification as unknown as Record<string, unknown>)
        : null,
      botReply: dryRun.reply?.text ?? (dryRun.handoff.required ? `[handoff: ${dryRun.handoff.reason}]` : null),
      templateScenario: dryRun.templateScenario ?? (dryRun.handoff.required ? 'handoff' : null),
    });

    this.logger.log(`Learning dry-run complete for conversation ${conversationId}: template=${dryRun.templateScenario ?? 'none'}`);
  }

  private conversationLockKey(conversationId: string): number {
    // Hash UUID to a 32-bit integer for pg_advisory_lock
    let hash = 0;
    for (let i = 0; i < conversationId.length; i++) {
      hash = ((hash << 5) - hash + conversationId.charCodeAt(i)) | 0;
    }
    return hash;
  }

  /**
   * Persistent fallback for bot-echo detection. Returns true if the bot sent
   * an outbound message to this customer's conversation within `windowMs`.
   * Used when the in-memory dedup maps miss (e.g. after a server restart).
   */
  private async hasRecentOutbound(
    customerExternalId: string,
    windowMs: number,
  ): Promise<boolean> {
    try {
      const rows: Array<{ exists: boolean }> = await this.dataSource.query(
        `SELECT EXISTS (
           SELECT 1
           FROM messages m
           JOIN conversations c ON c.id = m.conversation_id
           JOIN customers cu ON cu.id = c.customer_id
           WHERE cu.external_user_id = $1
             AND m.direction = 'outbound'
             AND m.created_at > NOW() - ($2::int * INTERVAL '1 millisecond')
         ) AS exists`,
        [customerExternalId, windowMs],
      );
      return rows[0]?.exists === true;
    } catch (err) {
      this.logger.warn(`hasRecentOutbound query failed: ${(err as Error).message}`);
      return false;
    }
  }

  // ─── Manager reply detection ──────────────────────────────────

  private async handleManagerReply(messaging: MetaMessagingEvent, channelAccountId: string): Promise<void> {
    const customerId = messaging.recipient?.id;
    if (!customerId) return;

    const connection = await this.integrationsService.findByExternalAccountId(
      channelAccountId, ConnectionType.Instagram,
    );
    if (!connection) return;

    const customer = await this.conversationsService.findCustomer(
      connection.tenantId, 'instagram', customerId,
    );
    if (!customer) return;

    const conversation = await this.conversationsService.findConversationByCustomer(
      connection.tenantId, customer.id, 'instagram', channelAccountId,
    );
    if (!conversation) return;

    const managerText = messaging.message?.text ?? '';

    // Save manager's message
    await this.conversationsService.saveMessage(
      conversation.id, connection.tenantId,
      MessageDirection.Outbound, MessageRole.Manager,
      managerText, messaging.message?.mid,
    );

    // Learning mode: record manager reply paired with the last customer message
    const storeConfig = await this.storeConfigRepo.findOne({ where: { tenantId: connection.tenantId } });
    if (storeConfig?.operatingMode === 'learning' && managerText) {
      await this.learningObserver.recordManagerReply(connection.tenantId, conversation.id, managerText);
    }

    // Set conversation to human_in_control (manager already took over, no handoff needed)
    if (conversation.status !== ConversationStatus.HumanInControl) {
      await this.conversationsService.takeover(conversation.id, null, 'auto_detected');
      this.logger.log(`Manager reply detected → conversation ${conversation.id} set to human_in_control`);
    }

    // Reset auto-resume timer
    await this.setAutoResumeDeadline(conversation.id);
  }

  private async setAutoResumeDeadline(conversationId: string, delayMs = 30 * 60 * 1000): Promise<void> {
    const autoResumeAt = new Date(Date.now() + delayMs);
    await this.conversationRepo.update(conversationId, { autoResumeAt });
    this.logger.log(`Auto-resume set for ${conversationId} at ${autoResumeAt.toISOString()}`);
  }
}
