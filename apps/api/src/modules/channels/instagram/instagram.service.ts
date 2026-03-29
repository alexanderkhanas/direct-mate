import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { ConversationsService } from '../../conversations/conversations.service';
import { ReplyEngineService } from '../../conversations/reply-engine.service';
import { IntegrationsService } from '../../integrations/integrations.service';
import { OrdersService } from '../../orders/orders.service';
import { CryptoService } from '../../../common/crypto.service';
import { TelegramService } from '../../notifications/telegram.service';
import { Connection } from '../../integrations/entities/connection.entity';
import { ConnectionType, MessageDirection, MessageRole, ReplyDecision } from '@direct-mate/shared';

interface MediaReference {
  mediaId: string;
  type: 'story_reply' | 'post_reply' | 'customer_photo';
}

interface MetaMessagingEvent {
  sender?: { id: string };
  recipient?: { id: string };
  message?: {
    mid: string;
    text?: string;
    reply_to?: { mid?: string; story?: { id: string } };
    attachments?: Array<{ type: string; payload?: { url?: string } }>;
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

interface PendingMessage {
  messageId: string;
  text: string;
  mediaReference?: MediaReference | null;
}

interface PendingReply {
  timer: ReturnType<typeof setTimeout>;
  messages: PendingMessage[];
  externalUserId: string;
  channelAccountId: string;
  connection: Connection;
  tenantId: string;
}

@Injectable()
export class InstagramService {
  private readonly logger = new Logger(InstagramService.name);
  private readonly pendingReplies = new Map<string, PendingReply>();

  constructor(
    private readonly config: ConfigService,
    private readonly conversationsService: ConversationsService,
    private readonly replyEngineService: ReplyEngineService,
    private readonly integrationsService: IntegrationsService,
    private readonly ordersService: OrdersService,
    private readonly cryptoService: CryptoService,
    private readonly telegramService: TelegramService,
  ) {}

  private async sendMetaMessage(
    recipientId: string,
    text: string,
    pageAccessToken: string,
  ): Promise<void> {
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
  }

  verifySignature(rawBody: Buffer, signature: string): boolean {
    const appSecret = this.config.get<string>('meta.appSecret') ?? '';
    if (!appSecret) return true;
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

    // Customer photo: attachments with image/video type
    if (message.attachments?.length) {
      const mediaAttachment = message.attachments.find(
        (a) => a.type === 'image' || a.type === 'video',
      );
      if (mediaAttachment) {
        return {
          mediaId: mediaAttachment.payload?.url ?? 'unknown',
          type: 'customer_photo',
        };
      }
    }

    return null;
  }

  async handleWebhook(payload: MetaWebhookPayload): Promise<void> {
    if (payload.object !== 'instagram') return;

    for (const entry of payload.entry) {
      const entryId = entry.id;

      for (const messaging of entry.messaging ?? []) {
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

    const { conversation } = await this.conversationsService.findOrCreateConversation(
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

    // Debounce: wait for more messages before processing
    const debounceKey = `${externalUserId}:${channelAccountId}`;
    const existing = this.pendingReplies.get(debounceKey);

    if (existing) {
      // More messages coming — reset timer, accumulate
      clearTimeout(existing.timer);
      existing.messages.push({ messageId, text: messageText, mediaReference });
      this.logger.log(
        `Debounce: added message #${existing.messages.length} for ${debounceKey}, resetting timer`,
      );
      existing.timer = setTimeout(() => this.flushPending(debounceKey), DEBOUNCE_MS);
    } else {
      // First message — start debounce timer
      this.logger.log(`Debounce: first message for ${debounceKey}, waiting ${DEBOUNCE_MS / 1000}s`);
      const pending: PendingReply = {
        timer: setTimeout(() => this.flushPending(debounceKey), DEBOUNCE_MS),
        messages: [{ messageId, text: messageText, mediaReference }],
        externalUserId,
        channelAccountId,
        connection,
        tenantId: connection.tenantId,
      };
      this.pendingReplies.set(debounceKey, pending);
    }
  }

  private async flushPending(debounceKey: string): Promise<void> {
    const pending = this.pendingReplies.get(debounceKey);
    if (!pending) return;
    this.pendingReplies.delete(debounceKey);

    const combinedText = pending.messages.map((m) => m.text).join('\n');
    const mediaReference =
      pending.messages.find((m) => m.mediaReference)?.mediaReference ?? null;
    this.logger.log(
      `Debounce: processing ${pending.messages.length} message(s) for ${debounceKey}: "${combinedText.substring(0, 100)}"`,
    );

    try {
      await this.processInbound({
        tenantId: pending.tenantId,
        externalUserId: pending.externalUserId,
        channelAccountId: pending.channelAccountId,
        messageText: combinedText,
        connection: pending.connection,
        mediaReference,
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

    const recentMessages = (
      await this.conversationsService.findById(conversation.id)
    ).messages
      .slice(-10)
      .map((m) => ({ role: m.role, text: m.text }));

    const result = await this.replyEngineService.process({
      tenantId: params.tenantId,
      conversationId: conversation.id,
      messageText: params.messageText,
      state,
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

      // Notify manager via Telegram
      this.telegramService.notifyHandoff({
        tenantId: params.tenantId,
        customerName: customer.username ? `@${customer.username}` : customer.fullName || params.externalUserId,
        reason: result.handoff.reason ?? 'unknown',
        conversationId: conversation.id,
        lastMessage: params.messageText,
      }).catch(err => this.logger.error('Telegram notification failed', err));

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
          await this.sendMetaMessage(params.externalUserId, result.reply.text, pageAccessToken);
          this.logger.log(`Message sent to ${params.externalUserId} via Meta Graph API`);
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

        // Trigger external sync (async, fire-and-forget)
        this.ordersService.triggerExternalSync(order).catch((err) => {
          this.logger.error(
            `External sync trigger failed for order ${order.id}`,
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
  }
}
