import { ConversationStatus } from '@direct-mate/shared';
import { Customer } from './customer.entity';
import { Message } from './message.entity';
import { ConversationState } from './conversation-state.entity';
export declare class Conversation {
    id: string;
    tenantId: string;
    customerId: string;
    channel: string;
    channelAccountId: string | null;
    status: ConversationStatus;
    needsHandoff: boolean;
    handoffReason: string | null;
    lastMessageAt: Date | null;
    autoResumeAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    customer: Customer;
    messages: Message[];
    state: ConversationState;
}
