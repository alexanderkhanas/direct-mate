import { ConfigService } from '@nestjs/config';
import { ConversationsService } from '../../conversations/conversations.service';
import { ReplyEngineService } from '../../conversations/reply-engine.service';
interface MetaMessagingEntry {
    messaging?: Array<{
        sender: {
            id: string;
        };
        recipient: {
            id: string;
        };
        message?: {
            mid: string;
            text: string;
        };
        timestamp: number;
    }>;
}
interface MetaWebhookPayload {
    object: string;
    entry: MetaMessagingEntry[];
}
export declare class InstagramService {
    private readonly config;
    private readonly conversationsService;
    private readonly replyEngineService;
    private readonly logger;
    constructor(config: ConfigService, conversationsService: ConversationsService, replyEngineService: ReplyEngineService);
    verifySignature(rawBody: Buffer, signature: string): boolean;
    verifyWebhook(mode: string, token: string, challenge: string): string;
    handleWebhook(tenantId: string, payload: MetaWebhookPayload): Promise<void>;
    private processInbound;
}
export {};
