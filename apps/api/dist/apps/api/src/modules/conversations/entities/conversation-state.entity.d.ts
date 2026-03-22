import { ConversationStateStatus } from '@direct-mate/shared';
import { Conversation } from './conversation.entity';
export declare class ConversationState {
    id: string;
    conversationId: string;
    stateStatus: ConversationStateStatus;
    selectedProductId: string | null;
    selectedVariantId: string | null;
    activeCheckoutSessionId: string | null;
    lastAiConfidence: number | null;
    contextJson: Record<string, unknown> | null;
    updatedAt: Date;
    conversation: Conversation;
}
