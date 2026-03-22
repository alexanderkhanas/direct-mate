import { Repository } from 'typeorm';
import { TenantSettings } from '../tenants/entities/tenant-settings.entity';
import { ManagerExample } from '../settings/entities/manager-example.entity';
import { ConversationState } from './entities/conversation-state.entity';
import { AvailabilityService } from '../availability/availability.service';
import { AuditService } from '../audit/audit.service';
import { ReplyDecision } from '@direct-mate/shared';
export interface ReplyEngineInput {
    tenantId: string;
    conversationId: string;
    messageText: string;
    state: ConversationState;
    recentMessages: Array<{
        role: string;
        text: string | null;
    }>;
}
export interface ReplyEngineOutput {
    decision: ReplyDecision;
    reply: {
        text: string;
        sendNow: boolean;
    } | null;
    handoff: {
        required: boolean;
        reason: string | null;
    };
    stateUpdate: Partial<ConversationState> | null;
}
export declare class ReplyEngineService {
    private readonly settingsRepo;
    private readonly examplesRepo;
    private readonly availabilityService;
    private readonly auditService;
    private readonly logger;
    constructor(settingsRepo: Repository<TenantSettings>, examplesRepo: Repository<ManagerExample>, availabilityService: AvailabilityService, auditService: AuditService);
    process(input: ReplyEngineInput): Promise<ReplyEngineOutput>;
    private runAvailabilityCheck;
    private generateReply;
}
