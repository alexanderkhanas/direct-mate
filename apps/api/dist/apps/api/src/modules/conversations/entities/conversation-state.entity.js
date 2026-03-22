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
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConversationState = void 0;
const typeorm_1 = require("typeorm");
const shared_1 = require("@direct-mate/shared");
const conversation_entity_1 = require("./conversation.entity");
let ConversationState = class ConversationState {
};
exports.ConversationState = ConversationState;
__decorate([
    (0, typeorm_1.PrimaryGeneratedColumn)('uuid'),
    __metadata("design:type", String)
], ConversationState.prototype, "id", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'uuid', unique: true }),
    __metadata("design:type", String)
], ConversationState.prototype, "conversationId", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'text', default: shared_1.ConversationStateStatus.Browsing }),
    __metadata("design:type", String)
], ConversationState.prototype, "stateStatus", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'uuid', nullable: true }),
    __metadata("design:type", Object)
], ConversationState.prototype, "selectedProductId", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'uuid', nullable: true }),
    __metadata("design:type", Object)
], ConversationState.prototype, "selectedVariantId", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'uuid', nullable: true }),
    __metadata("design:type", Object)
], ConversationState.prototype, "activeCheckoutSessionId", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'numeric', precision: 4, scale: 3, nullable: true }),
    __metadata("design:type", Object)
], ConversationState.prototype, "lastAiConfidence", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'jsonb', nullable: true }),
    __metadata("design:type", Object)
], ConversationState.prototype, "contextJson", void 0);
__decorate([
    (0, typeorm_1.UpdateDateColumn)({ type: 'timestamptz' }),
    __metadata("design:type", Date)
], ConversationState.prototype, "updatedAt", void 0);
__decorate([
    (0, typeorm_1.OneToOne)(() => conversation_entity_1.Conversation, (c) => c.state, { onDelete: 'CASCADE' }),
    (0, typeorm_1.JoinColumn)({ name: 'conversation_id' }),
    __metadata("design:type", conversation_entity_1.Conversation)
], ConversationState.prototype, "conversation", void 0);
exports.ConversationState = ConversationState = __decorate([
    (0, typeorm_1.Entity)('conversation_state')
], ConversationState);
//# sourceMappingURL=conversation-state.entity.js.map