import { Repository } from 'typeorm';
import { Conversation } from './entities/conversation.entity';
import { Customer } from './entities/customer.entity';
import { Message } from './entities/message.entity';
import { ConversationState } from './entities/conversation-state.entity';
import { ConversationStatus, MessageDirection, MessageRole } from '@direct-mate/shared';
export declare class ConversationsService {
    private readonly conversationRepo;
    private readonly customerRepo;
    private readonly messageRepo;
    private readonly stateRepo;
    constructor(conversationRepo: Repository<Conversation>, customerRepo: Repository<Customer>, messageRepo: Repository<Message>, stateRepo: Repository<ConversationState>);
    findOrCreateCustomer(tenantId: string, channel: string, externalUserId: string): Promise<Customer>;
    updateCustomer(id: string, data: {
        username?: string | null;
        fullName?: string | null;
    }): Promise<void>;
    findOrCreateConversation(tenantId: string, customerId: string, channel: string, channelAccountId: string): Promise<{
        conversation: Conversation;
        state: ConversationState;
    }>;
    saveMessage(conversationId: string, tenantId: string, direction: MessageDirection, role: MessageRole, text: string, externalMessageId?: string, rawPayload?: Record<string, unknown> | null): Promise<Message>;
    findAll(tenantId: string, filters: {
        status?: string;
        needsHandoff?: boolean;
        page?: number;
        limit?: number;
    }): Promise<{
        items: Conversation[];
        page: number;
        limit: number;
        total: number;
    }>;
    findById(id: string, tenantId?: string): Promise<Conversation>;
    takeover(id: string, tenantId: string | null, managerUserId: string): Promise<Conversation>;
    release(id: string, tenantId?: string | null): Promise<Conversation>;
    getState(conversationId: string): Promise<ConversationState | null>;
    updateState(conversationId: string, patch: Partial<ConversationState>): Promise<void>;
    escalate(conversationId: string, reason: string): Promise<void>;
    findCustomer(tenantId: string, channel: string, externalUserId: string): Promise<Customer | null>;
    findConversationByCustomer(tenantId: string, customerId: string, channel: string, channelAccountId: string): Promise<Conversation | null>;
    findByStatus(status: ConversationStatus): Promise<Conversation[]>;
}
