import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { TenantSettings } from '../tenants/entities/tenant-settings.entity';
import { ManagerExample } from '../settings/entities/manager-example.entity';
import { ConversationState } from './entities/conversation-state.entity';
import { StoreConfig } from '../engine/entities/store-config.entity';
import { AvailabilityService } from '../availability/availability.service';
import { AuditService } from '../audit/audit.service';
import { ClassifierService, ClassificationResult } from '../engine/classifier.service';
import { TemplateEngineService } from '../engine/template-engine.service';
import { PolicyEngineService } from '../engine/policy-engine.service';
import { ReplyDecision } from '@direct-mate/shared';
import { OrderPayload } from '../orders/interfaces/order-payload.interface';
import { InstagramContentService } from '../channels/instagram/instagram-content.service';
import { SizeChartsService } from '../size-charts/size-charts.service';
export interface ReplyEngineInput {
    tenantId: string;
    conversationId: string;
    messageText: string;
    state: ConversationState;
    recentMessages: Array<{
        role: string;
        text: string | null;
    }>;
    mediaReference?: {
        mediaId: string;
        type: string;
    };
}
export interface ReplyEngineOutput {
    decision: ReplyDecision;
    reply: {
        text: string;
        sendNow: boolean;
        imageUrls?: string[];
    } | null;
    extraReplies?: Array<{
        text: string;
        sendNow: boolean;
        imageUrls?: string[];
    }>;
    handoff: {
        required: boolean;
        reason: string | null;
    };
    stateUpdate: Partial<ConversationState> | null;
    orderPayload?: OrderPayload;
    classification?: ClassificationResult;
    templateScenario?: string;
    trace?: string[];
}
export declare class ReplyEngineService {
    private readonly settingsRepo;
    private readonly examplesRepo;
    private readonly storeConfigRepo;
    private readonly availabilityService;
    private readonly auditService;
    private readonly classifierService;
    private readonly templateEngine;
    private readonly policyEngine;
    private readonly config;
    private readonly instagramContentService;
    private readonly subscriptionsService;
    private readonly sizeChartsService;
    private static readonly TITLE_STOP_WORDS;
    private static readonly TITLE_GENERIC_NOUNS;
    private readonly logger;
    private readonly openai;
    private readonly model;
    private logToFile;
    constructor(settingsRepo: Repository<TenantSettings>, examplesRepo: Repository<ManagerExample>, storeConfigRepo: Repository<StoreConfig>, availabilityService: AvailabilityService, auditService: AuditService, classifierService: ClassifierService, templateEngine: TemplateEngineService, policyEngine: PolicyEngineService, config: ConfigService, instagramContentService: InstagramContentService, subscriptionsService: SubscriptionsService, sizeChartsService: SizeChartsService);
    process(input: ReplyEngineInput): Promise<ReplyEngineOutput>;
    private loadContext;
    private classifyMessage;
    private resolveMediaProduct;
    private handlePreQualify;
    private handlePreQualifyClothing;
    private classifyOfferAnswer;
    private handlePreQualifyCosmetics;
    private searchAndFilterProducts;
    private resolveVariantSelection;
    private buildResponse;
    private maybeAttachSizeChart;
    private scenarioToAction;
    private setConfirmIntent;
    private buildAvailableVariantsList;
    private resolveShortReply;
    private static readonly COLOR_TRANSLATIONS;
    private translateColor;
    private matchVariant;
    private matchColorOrSize;
    private maybeMidFlowSizeHelp;
    private looksLikePreQualifyData;
    private extractPreQualifyData;
    private recommendSize;
    private shouldSearchProducts;
    private extractSearchKeywords;
    private narrowByProductName;
    private titlesOverlap;
    private shouldAdoptSearchLock;
    private searchProducts;
    private updateMemoryFromAction;
    private buildOrderPayload;
    private getCurrentStage;
    private buildOrderStateContext;
    private aiFallbackReply;
    private buildProductContext;
    private buildMemoryContext;
    private handleSizeChartRequest;
    private doHandoff;
}
