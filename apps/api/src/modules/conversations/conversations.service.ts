import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Conversation } from './entities/conversation.entity';
import { Customer } from './entities/customer.entity';
import { Message } from './entities/message.entity';
import { ConversationState } from './entities/conversation-state.entity';
import {
  ConversationStatus,
  ConversationStateStatus,
  MessageDirection,
  MessageRole,
} from '@direct-mate/shared';

@Injectable()
export class ConversationsService {
  constructor(
    @InjectRepository(Conversation)
    private readonly conversationRepo: Repository<Conversation>,
    @InjectRepository(Customer)
    private readonly customerRepo: Repository<Customer>,
    @InjectRepository(Message)
    private readonly messageRepo: Repository<Message>,
    @InjectRepository(ConversationState)
    private readonly stateRepo: Repository<ConversationState>,
  ) {}

  async findOrCreateCustomer(
    tenantId: string,
    channel: string,
    externalUserId: string,
  ): Promise<Customer> {
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

  async updateCustomer(id: string, data: { username?: string | null; fullName?: string | null }): Promise<void> {
    await this.customerRepo.update(id, data as any);
  }

  async findOrCreateConversation(
    tenantId: string,
    customerId: string,
    channel: string,
    channelAccountId: string,
  ): Promise<{ conversation: Conversation; state: ConversationState }> {
    let conversation = await this.conversationRepo.findOne({
      where: [
        { tenantId, customerId, channel, channelAccountId, status: ConversationStatus.Active },
        { tenantId, customerId, channel, channelAccountId, status: ConversationStatus.HumanInControl },
      ],
      order: { lastMessageAt: 'DESC' },
    });

    // Close stale conversations (idle >72h) so returning customers get fresh state
    if (conversation) {
      const staleThreshold = new Date(Date.now() - 72 * 60 * 60 * 1000);
      if (conversation.lastMessageAt && conversation.lastMessageAt < staleThreshold) {
        await this.conversationRepo.update(conversation.id, { status: ConversationStatus.Closed });
        conversation = null as any;
      }
    }

    if (!conversation) {
      conversation = this.conversationRepo.create({
        tenantId,
        customerId,
        channel,
        channelAccountId,
        status: ConversationStatus.Active,
      });
      conversation = await this.conversationRepo.save(conversation);
    }

    let state = await this.stateRepo.findOne({
      where: { conversationId: conversation.id },
    });
    if (!state) {
      state = this.stateRepo.create({
        conversationId: conversation.id,
        stateStatus: ConversationStateStatus.Browsing,
      });
      state = await this.stateRepo.save(state);
    }

    return { conversation, state };
  }

  async saveMessage(
    conversationId: string,
    tenantId: string,
    direction: MessageDirection,
    role: MessageRole,
    text: string,
    externalMessageId?: string,
    rawPayload?: Record<string, unknown> | null,
  ): Promise<Message> {
    const msg = this.messageRepo.create({
      conversationId,
      tenantId,
      direction,
      role,
      text,
      externalMessageId,
      rawPayload: rawPayload ?? null,
    });
    await this.conversationRepo.update(conversationId, { lastMessageAt: new Date() });
    return this.messageRepo.save(msg);
  }

  async findAll(
    tenantId: string,
    filters: { status?: string; needsHandoff?: boolean; page?: number; limit?: number },
  ) {
    const { page = 1, limit = 20 } = filters;
    const qb = this.conversationRepo
      .createQueryBuilder('c')
      .innerJoinAndSelect('c.customer', 'cust')
      .where('c.tenant_id = :tenantId', { tenantId })
      .orderBy('c.lastMessageAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    if (filters.status) qb.andWhere('c.status = :status', { status: filters.status });
    if (filters.needsHandoff !== undefined) {
      qb.andWhere('c.needs_handoff = :needsHandoff', { needsHandoff: filters.needsHandoff });
    }

    const [items, total] = await qb.getManyAndCount();
    return { items, page, limit, total };
  }

  async findById(id: string, tenantId?: string): Promise<Conversation> {
    const where: any = { id };
    if (tenantId) where.tenantId = tenantId;
    const conv = await this.conversationRepo.findOne({
      where,
      relations: ['customer', 'messages', 'state'],
    });
    if (!conv) throw new NotFoundException(`Conversation ${id} not found`);
    return conv;
  }

  async takeover(id: string, tenantId: string | null, managerUserId: string): Promise<Conversation> {
    const where: any = { id };
    if (tenantId) where.tenantId = tenantId;
    const conv = await this.conversationRepo.findOne({ where });
    if (!conv) throw new NotFoundException(`Conversation ${id} not found`);
    await this.conversationRepo.update(id, {
      status: ConversationStatus.HumanInControl,
      needsHandoff: false,
    });
    return this.conversationRepo.findOneOrFail({ where: { id } });
  }

  async release(id: string, tenantId?: string | null): Promise<Conversation> {
    const where: any = { id };
    if (tenantId) where.tenantId = tenantId;
    const conv = await this.conversationRepo.findOne({ where });
    if (!conv) throw new NotFoundException(`Conversation ${id} not found`);
    await this.conversationRepo.update(id, { status: ConversationStatus.Active, needsHandoff: false });
    return this.conversationRepo.findOneOrFail({ where: { id } });
  }

  async getState(conversationId: string): Promise<ConversationState | null> {
    return this.stateRepo.findOne({ where: { conversationId } });
  }

  async updateState(
    conversationId: string,
    patch: Partial<ConversationState>,
  ): Promise<void> {
    await this.stateRepo.update({ conversationId }, patch as any);
  }

  async escalate(conversationId: string, reason: string): Promise<void> {
    await this.conversationRepo.update(conversationId, {
      needsHandoff: true,
      handoffReason: reason,
      status: ConversationStatus.HumanInControl,
    });
  }

  async findCustomer(tenantId: string, channel: string, externalUserId: string): Promise<Customer | null> {
    return this.customerRepo.findOne({ where: { tenantId, channel, externalUserId } });
  }

  async findConversationByCustomer(
    tenantId: string, customerId: string, channel: string, channelAccountId: string,
  ): Promise<Conversation | null> {
    return this.conversationRepo.findOne({
      where: [
        { tenantId, customerId, channel, channelAccountId, status: ConversationStatus.Active },
        { tenantId, customerId, channel, channelAccountId, status: ConversationStatus.HumanInControl },
      ],
      order: { lastMessageAt: 'DESC' },
    });
  }

  async findByStatus(status: ConversationStatus): Promise<Conversation[]> {
    return this.conversationRepo.find({ where: { status } });
  }
}
