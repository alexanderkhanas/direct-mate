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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConversationReplyController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const internal_api_key_guard_1 = require("../../common/guards/internal-api-key.guard");
const conversations_service_1 = require("./conversations.service");
const reply_engine_service_1 = require("./reply-engine.service");
const conversation_reply_dto_1 = require("./dto/conversation-reply.dto");
const shared_1 = require("@direct-mate/shared");
let ConversationReplyController = class ConversationReplyController {
    constructor(conversationsService, replyEngineService) {
        this.conversationsService = conversationsService;
        this.replyEngineService = replyEngineService;
    }
    async reply(dto) {
        const customer = await this.conversationsService.findOrCreateCustomer(dto.tenantId, dto.channel, dto.externalUserId);
        const { conversation, state } = await this.conversationsService.findOrCreateConversation(dto.tenantId, customer.id, dto.channel, dto.channelAccountId);
        await this.conversationsService.saveMessage(conversation.id, dto.tenantId, shared_1.MessageDirection.Inbound, shared_1.MessageRole.User, dto.messageText, dto.messageId);
        const recentMessages = (await this.conversationsService.findById(conversation.id)).messages
            .slice(-10)
            .map((m) => ({ role: m.role, text: m.text }));
        const result = await this.replyEngineService.process({
            tenantId: dto.tenantId,
            conversationId: conversation.id,
            messageText: dto.messageText,
            state,
            recentMessages,
        });
        if (result.stateUpdate) {
            await this.conversationsService.updateState(conversation.id, result.stateUpdate);
        }
        if (result.handoff.required) {
            await this.conversationsService.escalate(conversation.id, result.handoff.reason ?? 'unknown');
        }
        else if (result.reply?.sendNow && result.reply.text) {
            await this.conversationsService.saveMessage(conversation.id, dto.tenantId, shared_1.MessageDirection.Outbound, shared_1.MessageRole.Assistant, result.reply.text);
        }
        const updatedConv = await this.conversationsService.findById(conversation.id);
        return {
            conversationId: conversation.id,
            decision: result.decision,
            reply: result.reply,
            handoff: result.handoff,
            state: {
                status: updatedConv.state?.stateStatus,
                selectedProductId: updatedConv.state?.selectedProductId,
                selectedVariantId: updatedConv.state?.selectedVariantId,
            },
        };
    }
};
exports.ConversationReplyController = ConversationReplyController;
__decorate([
    (0, common_1.Post)('reply'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [conversation_reply_dto_1.ConversationReplyDto]),
    __metadata("design:returntype", Promise)
], ConversationReplyController.prototype, "reply", null);
exports.ConversationReplyController = ConversationReplyController = __decorate([
    (0, swagger_1.ApiTags)('conversation-reply'),
    (0, common_1.UseGuards)(internal_api_key_guard_1.InternalApiKeyGuard),
    (0, common_1.Controller)('conversation'),
    __metadata("design:paramtypes", [conversations_service_1.ConversationsService,
        reply_engine_service_1.ReplyEngineService])
], ConversationReplyController);
//# sourceMappingURL=conversation-reply.controller.js.map