import { Tenant } from './tenant.entity';
export interface BusinessHours {
    timezone: string;
    days: number[];
    start: string;
    end: string;
}
export interface HandoffRules {
    maxFailedTurns: number;
    stockFreshnessMinutes: number;
    negativeSentimentEscalation: boolean;
}
export interface AiSettings {
    model?: string;
    maxTokens?: number;
    temperature?: number;
}
export declare class TenantSettings {
    id: string;
    tenantId: string;
    brandTonePrompt: string | null;
    supportedLanguages: string[];
    businessHours: BusinessHours | null;
    handoffRules: HandoffRules | null;
    aiSettings: AiSettings | null;
    createdAt: Date;
    updatedAt: Date;
    tenant: Tenant;
}
