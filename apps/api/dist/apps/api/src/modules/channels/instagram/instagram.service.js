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
const shared_1 = require("@direct-mate/shared");
let InstagramService = InstagramService_1 = class InstagramService {
    constructor(config, conversationsService, replyEngineService) {
        this.config = config;
        this.conversationsService = conversationsService;
        this.replyEngineService = replyEngineService;
        this.logger = new common_1.Logger(InstagramService_1.name);
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
    async handleWebhook(tenantId, payload) {
        if (payload.object !== 'instagram')
            return;
        for (const entry of payload.entry) {
            for (const messaging of entry.messaging ?? []) {
                if (!messaging.message?.text)
                    continue;
                const externalUserId = messaging.sender.id;
                const channelAccountId = messaging.recipient.id;
                const messageId = messaging.message.mid;
                const messageText = messaging.message.text;
                try {
                    await this.processInbound({
                        tenantId,
                        externalUserId,
                        channelAccountId,
                        messageId,
                        messageText,
                    });
                }
                catch (err) {
                    this.logger.error(`Failed to process message ${messageId}`, err);
                }
            }
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
            return;
        }
        if (result.reply?.sendNow && result.reply.text) {
            await this.conversationsService.saveMessage(conversation.id, params.tenantId, shared_1.MessageDirection.Outbound, shared_1.MessageRole.Assistant, result.reply.text);
            this.logger.log(`[SEND] ${result.reply.text}`);
        }
    }
};
exports.InstagramService = InstagramService;
exports.InstagramService = InstagramService = InstagramService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService,
        conversations_service_1.ConversationsService,
        reply_engine_service_1.ReplyEngineService])
], InstagramService);
//# sourceMappingURL=instagram.service.js.map