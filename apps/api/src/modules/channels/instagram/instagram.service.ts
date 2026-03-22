import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { ConversationsService } from '../../conversations/conversations.service';
import { ReplyEngineService } from '../../conversations/reply-engine.service';
import { IntegrationsService } from '../../integrations/integrations.service';
import { CryptoService } from '../../../common/crypto.service';
import { Connection } from '../../integrations/entities/connection.entity';
import { ConnectionType, MessageDirection, MessageRole, ReplyDecision } from '@direct-mate/shared';

interface MetaMessagingEvent {
  sender?: { id: string };
  recipient?: { id: string };
  message?: { mid: string; text: string };
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

@Injectable()
export class InstagramService {
  private readonly logger = new Logger(InstagramService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly conversationsService: ConversationsService,
    private readonly replyEngineService: ReplyEngineService,
    private readonly integrationsService: IntegrationsService,
    private readonly cryptoService: CryptoService,
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

  async handleWebhook(payload: MetaWebhookPayload): Promise<void> {
    if (payload.object !== 'instagram') return;

    for (const entry of payload.entry) {
      const entryId = entry.id;

      for (const messaging of entry.messaging ?? []) {
        // Standard message event
        if (messaging.message?.text && messaging.sender && messaging.recipient) {
          await this.handleIncomingMessage(
            messaging.sender.id,
            messaging.recipient.id,
            messaging.message.mid,
            messaging.message.text,
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

    try {
      await this.processInbound({
        tenantId: connection.tenantId,
        externalUserId,
        channelAccountId,
        messageId,
        messageText,
        connection,
      });
    } catch (err) {
      this.logger.error(`Failed to process message ${messageId}`, err);
    }
  }

  private async processInbound(params: {
    tenantId: string;
    externalUserId: string;
    channelAccountId: string;
    messageId: string;
    messageText: string;
    connection: Connection;
  }): Promise<void> {
    const customer = await this.conversationsService.findOrCreateCustomer(
      params.tenantId,
      'instagram',
      params.externalUserId,
    );

    const { conversation, state } = await this.conversationsService.findOrCreateConversation(
      params.tenantId,
      customer.id,
      'instagram',
      params.channelAccountId,
    );

    await this.conversationsService.saveMessage(
      conversation.id,
      params.tenantId,
      MessageDirection.Inbound,
      MessageRole.User,
      params.messageText,
      params.messageId,
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

      // TODO: send Telegram notification to manager
      this.logger.log(`HANDOFF: conversation ${conversation.id}, reason: ${result.handoff.reason}`);
      return;
    }

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
  }
}
