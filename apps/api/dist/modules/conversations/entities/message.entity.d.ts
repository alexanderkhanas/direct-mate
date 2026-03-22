import { MessageDirection, MessageRole } from '@direct-mate/shared';
import { Conversation } from './conversation.entity';
export declare class Message {
    id: string;
    conversationId: string;
    tenantId: string;
    direction: MessageDirection;
    role: MessageRole;
    externalMessageId: string | null;
    text: string | null;
    rawPayload: Record<string, unknown> | null;
    toolCalls: unknown[] | null;
    createdAt: Date;
    conversation: Conversation;
}
