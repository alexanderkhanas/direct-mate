import { OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, Repository } from 'typeorm';
import { ConversationsService } from '../../conversations/conversations.service';
import { ReplyEngineService } from '../../conversations/reply-engine.service';
import { IntegrationsService } from '../../integrations/integrations.service';
import { OrdersService } from '../../orders/orders.service';
import { CryptoService } from '../../../common/crypto.service';
import { TelegramService } from '../../notifications/telegram.service';
import { PendingMessage } from './entities/pending-message.entity';
import { Conversation } from '../../conversations/entities/conversation.entity';
interface MetaMessagingEvent {
    sender?: {
        id: string;
    };
    recipient?: {
        id: string;
    };
    message?: {
        mid: string;
        text?: string;
        is_echo?: boolean;
        reply_to?: {
            mid?: string;
            story?: {
                id: string;
            };
        };
        attachments?: Array<{
            type: string;
            payload?: {
                url?: string;
            };
        }>;
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
export declare class InstagramService implements OnModuleInit, OnModuleDestroy {
    private readonly config;
    private readonly conversationsService;
    private readonly replyEngineService;
    private readonly integrationsService;
    private readonly ordersService;
    private readonly cryptoService;
    private readonly telegramService;
    private readonly pendingMessageRepo;
    private readonly conversationRepo;
    private readonly dataSource;
    private readonly logger;
    private readonly recentSentMids;
    private pollInterval;
    constructor(config: ConfigService, conversationsService: ConversationsService, replyEngineService: ReplyEngineService, integrationsService: IntegrationsService, ordersService: OrdersService, cryptoService: CryptoService, telegramService: TelegramService, pendingMessageRepo: Repository<PendingMessage>, conversationRepo: Repository<Conversation>, dataSource: DataSource);
    onModuleInit(): Promise<void>;
    onModuleDestroy(): void;
    private pollTasks;
    private flushReadyMessages;
    private autoResumeExpired;
    private sendMetaMessage;
    private sendMetaImages;
    verifySignature(rawBody: Buffer, signature: string): boolean;
    verifyWebhook(mode: string, token: string, challenge: string): string;
    private fetchMessageFromApi;
    private extractMediaReference;
    handleWebhook(payload: MetaWebhookPayload): Promise<void>;
    private handleIncomingMessage;
    private flushPending;
    private processInbound;
    private conversationLockKey;
    private handleManagerReply;
    private setAutoResumeDeadline;
}
export {};
