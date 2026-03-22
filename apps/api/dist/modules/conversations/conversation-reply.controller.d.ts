import { ConversationsService } from './conversations.service';
import { ReplyEngineService } from './reply-engine.service';
import { ConversationReplyDto } from './dto/conversation-reply.dto';
export declare class ConversationReplyController {
    private readonly conversationsService;
    private readonly replyEngineService;
    constructor(conversationsService: ConversationsService, replyEngineService: ReplyEngineService);
    reply(dto: ConversationReplyDto): Promise<{
        conversationId: string;
        decision: import("@direct-mate/shared").ReplyDecision;
        reply: {
            text: string;
            sendNow: boolean;
        } | null;
        handoff: {
            required: boolean;
            reason: string | null;
        };
        state: {
            status: import("@direct-mate/shared").ConversationStateStatus;
            selectedProductId: string | null;
            selectedVariantId: string | null;
        };
    }>;
}
