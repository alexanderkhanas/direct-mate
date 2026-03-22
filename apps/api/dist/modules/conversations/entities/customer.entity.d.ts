import { Conversation } from './conversation.entity';
export declare class Customer {
    id: string;
    tenantId: string;
    channel: string;
    externalUserId: string;
    username: string | null;
    fullName: string | null;
    phone: string | null;
    metadata: Record<string, unknown> | null;
    lastSeenAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    conversations: Conversation[];
}
