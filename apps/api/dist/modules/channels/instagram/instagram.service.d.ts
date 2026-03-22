import { ConfigService } from '@nestjs/config';
import { ConversationsService } from '../../conversations/conversations.service';
import { ReplyEngineService } from '../../conversations/reply-engine.service';
import { IntegrationsService } from '../../integrations/integrations.service';
import { CryptoService } from '../../../common/crypto.service';
interface MetaMessagingEvent {
    sender?: {
        id: string;
    };
    recipient?: {
        id: string;
    };
    message?: {
        mid: string;
        text: string;
    };
    message_edit?: {
        mid: string;
        num_edit: number;
    };
    timestamp: number;
}
interface MetaMessagingEntry {
    id?: string;
    time?: number;
    messaging?: MetaMessagingEvent[];
}
interface MetaWebhookPayload {
    object: string;
    entry: MetaMessagingEntry[];
}
export declare class InstagramService {
    private readonly config;
    private readonly conversationsService;
    private readonly replyEngineService;
    private readonly integrationsService;
    private readonly cryptoService;
    private readonly logger;
    constructor(config: ConfigService, conversationsService: ConversationsService, replyEngineService: ReplyEngineService, integrationsService: IntegrationsService, cryptoService: CryptoService);
    private sendMetaMessage;
    verifySignature(rawBody: Buffer, signature: string): boolean;
    verifyWebhook(mode: string, token: string, challenge: string): string;
    private fetchMessageFromApi;
    handleWebhook(payload: MetaWebhookPayload): Promise<void>;
    private handleIncomingMessage;
    private processInbound;
}
export {};
