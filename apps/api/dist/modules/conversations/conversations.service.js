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
exports.ConversationsService = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const conversation_entity_1 = require("./entities/conversation.entity");
const customer_entity_1 = require("./entities/customer.entity");
const message_entity_1 = require("./entities/message.entity");
const conversation_state_entity_1 = require("./entities/conversation-state.entity");
const shared_1 = require("@direct-mate/shared");
let ConversationsService = class ConversationsService {
    constructor(conversationRepo, customerRepo, messageRepo, stateRepo) {
        this.conversationRepo = conversationRepo;
        this.customerRepo = customerRepo;
        this.messageRepo = messageRepo;
        this.stateRepo = stateRepo;
    }
    async findOrCreateCustomer(tenantId, channel, externalUserId) {
        let customer = await this.customerRepo.findOne({
            where: { tenantId, channel, externalUserId },
        });
        if (!customer) {
            customer = this.customerRepo.create({ tenantId, channel, externalUserId });
            customer = await this.customerRepo.save(customer);
        }
        await this.customerRepo.update(customer.id, { lastSeenAt: new Date() });
        return customer;
    }
    async findOrCreateConversation(tenantId, customerId, channel, channelAccountId) {
        let conversation = await this.conversationRepo.findOne({
            where: {
                tenantId,
                customerId,
                channel,
                channelAccountId,
                status: shared_1.ConversationStatus.Active,
            },
        });
        if (!conversation) {
            conversation = this.conversationRepo.create({
                tenantId,
                customerId,
                channel,
                channelAccountId,
                status: shared_1.ConversationStatus.Active,
            });
            conversation = await this.conversationRepo.save(conversation);
        }
        let state = await this.stateRepo.findOne({
            where: { conversationId: conversation.id },
        });
        if (!state) {
            state = this.stateRepo.create({
                conversationId: conversation.id,
                stateStatus: shared_1.ConversationStateStatus.Browsing,
            });
            state = await this.stateRepo.save(state);
        }
        return { conversation, state };
    }
    async saveMessage(conversationId, tenantId, direction, role, text, externalMessageId) {
        const msg = this.messageRepo.create({
            conversationId,
            tenantId,
            direction,
            role,
            text,
            externalMessageId,
        });
        await this.conversationRepo.update(conversationId, { lastMessageAt: new Date() });
        return this.messageRepo.save(msg);
    }
    async findAll(tenantId, filters) {
        const { page = 1, limit = 20 } = filters;
        const qb = this.conversationRepo
            .createQueryBuilder('c')
            .innerJoinAndSelect('c.customer', 'cust')
            .where('c.tenant_id = :tenantId', { tenantId })
            .orderBy('c.last_message_at', 'DESC')
            .skip((page - 1) * limit)
            .take(limit);
        if (filters.status)
            qb.andWhere('c.status = :status', { status: filters.status });
        if (filters.needsHandoff !== undefined) {
            qb.andWhere('c.needs_handoff = :needsHandoff', { needsHandoff: filters.needsHandoff });
        }
        const [items, total] = await qb.getManyAndCount();
        return { items, page, limit, total };
    }
    async findById(id) {
        const conv = await this.conversationRepo.findOne({
            where: { id },
            relations: ['customer', 'messages', 'state'],
        });
        if (!conv)
            throw new common_1.NotFoundException(`Conversation ${id} not found`);
        return conv;
    }
    async takeover(id, managerUserId) {
        const conv = await this.conversationRepo.findOne({ where: { id } });
        if (!conv)
            throw new common_1.NotFoundException(`Conversation ${id} not found`);
        await this.conversationRepo.update(id, {
            status: shared_1.ConversationStatus.HumanInControl,
            needsHandoff: false,
        });
        return this.conversationRepo.findOneOrFail({ where: { id } });
    }
    async release(id) {
        const conv = await this.conversationRepo.findOne({ where: { id } });
        if (!conv)
            throw new common_1.NotFoundException(`Conversation ${id} not found`);
        await this.conversationRepo.update(id, { status: shared_1.ConversationStatus.Active });
        return this.conversationRepo.findOneOrFail({ where: { id } });
    }
    async updateState(conversationId, patch) {
        await this.stateRepo.update({ conversationId }, patch);
    }
    async escalate(conversationId, reason) {
        await this.conversationRepo.update(conversationId, {
            needsHandoff: true,
            handoffReason: reason,
            status: shared_1.ConversationStatus.HumanInControl,
        });
    }
};
exports.ConversationsService = ConversationsService;
exports.ConversationsService = ConversationsService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectRepository)(conversation_entity_1.Conversation)),
    __param(1, (0, typeorm_1.InjectRepository)(customer_entity_1.Customer)),
    __param(2, (0, typeorm_1.InjectRepository)(message_entity_1.Message)),
    __param(3, (0, typeorm_1.InjectRepository)(conversation_state_entity_1.ConversationState)),
    __metadata("design:paramtypes", [typeorm_2.Repository,
        typeorm_2.Repository,
        typeorm_2.Repository,
        typeorm_2.Repository])
], ConversationsService);
//# sourceMappingURL=conversations.service.js.map