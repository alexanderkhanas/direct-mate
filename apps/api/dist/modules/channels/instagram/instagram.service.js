"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var InstagramService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.InstagramService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const crypto = require("crypto");
const conversations_service_1 = require("../../conversations/conversations.service");
const reply_engine_service_1 = require("../../conversations/reply-engine.service");
const integrations_service_1 = require("../../integrations/integrations.service");
const crypto_service_1 = require("../../../common/crypto.service");
const shared_1 = require("@direct-mate/shared");
let InstagramService = InstagramService_1 = class InstagramService {
    constructor(config, conversationsService, replyEngineService, integrationsService, cryptoService) {
        this.config = config;
        this.conversationsService = conversationsService;
        this.replyEngineService = replyEngineService;
        this.integrationsService = integrationsService;
        this.cryptoService = cryptoService;
        this.logger = new common_1.Logger(InstagramService_1.name);
    }
    async sendMetaMessage(recipientId, text, pageAccessToken) {
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
    verifySignature(rawBody, signature) {
        const appSecret = this.config.get('meta.appSecret') ?? '';
        if (!appSecret)
            return true;
        const expected = `sha256=${crypto
            .createHmac('sha256', appSecret)
            .update(rawBody)
            .digest('hex')}`;
        return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
    }
    verifyWebhook(mode, token, challenge) {
        const verifyToken = this.config.get('meta.webhookVerifyToken') ?? '';
        if (mode === 'subscribe' && token === verifyToken) {
            return challenge;
        }
        throw new common_1.UnauthorizedException('Webhook verification failed');
    }
    async fetchMessageFromApi(messageId, accessToken) {
        try {
            const res = await fetch(`https://graph.instagram.com/v21.0/${messageId}?fields=from,to,message&access_token=${accessToken}`);
            if (!res.ok) {
                const errBody = await res.text();
                this.logger.warn(`Failed to fetch message ${messageId}: ${res.status} - ${errBody}`);
                return null;
            }
            return await res.json();
        }
        catch (err) {
            this.logger.error(`Error fetching message ${messageId}`, err);
            return null;
        }
    }
    async handleWebhook(payload) {
        if (payload.object !== 'instagram')
            return;
        for (const entry of payload.entry) {
            const entryId = entry.id;
            for (const messaging of entry.messaging ?? []) {
                if (messaging.message?.text && messaging.sender && messaging.recipient) {
                    await this.handleIncomingMessage(messaging.sender.id, messaging.recipient.id, messaging.message.mid, messaging.message.text);
                    continue;
                }
                if (messaging.message_edit && messaging.message_edit.num_edit === 0) {
                    this.logger.log(`Received message_edit (num_edit=0), fetching message content...`);
                    const connection = await this.integrationsService.findByExternalAccountId(entryId ?? '', shared_1.ConnectionType.Instagram);
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
                    if (senderId === entryId || senderId === connection.externalAccountId) {
                        this.logger.log(`Skipping own message`);
                        continue;
                    }
                    if (senderId && recipientId) {
                        await this.handleIncomingMessage(senderId, recipientId, messaging.message_edit.mid, msgData.message);
                    }
                    continue;
                }
            }
        }
    }
    async handleIncomingMessage(externalUserId, channelAccountId, messageId, messageText) {
        let connection = await this.integrationsService.findByExternalAccountId(channelAccountId, shared_1.ConnectionType.Instagram);
        if (!connection) {
            connection = await this.integrationsService.findByExternalAccountId(externalUserId, shared_1.ConnectionType.Instagram);
            if (connection) {
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
        }
        catch (err) {
            this.logger.error(`Failed to process message ${messageId}`, err);
        }
    }
    async processInbound(params) {
        const customer = await this.conversationsService.findOrCreateCustomer(params.tenantId, 'instagram', params.externalUserId);
        const { conversation, state } = await this.conversationsService.findOrCreateConversation(params.tenantId, customer.id, 'instagram', params.channelAccountId);
        await this.conversationsService.saveMessage(conversation.id, params.tenantId, shared_1.MessageDirection.Inbound, shared_1.MessageRole.User, params.messageText, params.messageId);
        const recentMessages = (await this.conversationsService.findById(conversation.id)).messages
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
            await this.conversationsService.escalate(conversation.id, result.handoff.reason ?? 'unknown');
            const handoffMessage = 'Секунду, уточню для вас інформацію 🙏';
            await this.conversationsService.saveMessage(conversation.id, params.tenantId, shared_1.MessageDirection.Outbound, shared_1.MessageRole.Assistant, handoffMessage);
            const encryptedToken = params.connection.accessTokenEncrypted;
            if (encryptedToken) {
                const pageAccessToken = this.cryptoService.decrypt(encryptedToken);
                await this.sendMetaMessage(params.externalUserId, handoffMessage, pageAccessToken).catch((err) => {
                    this.logger.error('Failed to send handoff message', err);
                });
            }
            this.logger.log(`HANDOFF: conversation ${conversation.id}, reason: ${result.handoff.reason}`);
            return;
        }
        if (result.reply?.sendNow && result.reply.text) {
            await this.conversationsService.saveMessage(conversation.id, params.tenantId, shared_1.MessageDirection.Outbound, shared_1.MessageRole.Assistant, result.reply.text);
            const encryptedToken = params.connection.accessTokenEncrypted;
            if (encryptedToken) {
                const pageAccessToken = this.cryptoService.decrypt(encryptedToken);
                try {
                    await this.sendMetaMessage(params.externalUserId, result.reply.text, pageAccessToken);
                    this.logger.log(`Message sent to ${params.externalUserId} via Meta Graph API`);
                }
                catch (err) {
                    this.logger.error(`Failed to send to Meta API for conversation ${conversation.id}`, err);
                    await this.conversationsService.escalate(conversation.id, 'send_failed');
                }
            }
            else {
                this.logger.warn(`No access token for connection — cannot send message to Meta`);
            }
        }
    }
};
exports.InstagramService = InstagramService;
exports.InstagramService = InstagramService = InstagramService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService,
        conversations_service_1.ConversationsService,
        reply_engine_service_1.ReplyEngineService,
        integrations_service_1.IntegrationsService,
        crypto_service_1.CryptoService])
], InstagramService);
//# sourceMappingURL=instagram.service.js.map