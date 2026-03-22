import { BusinessHours, HandoffRules } from '../entities/tenant-settings-types';
export declare class UpdateSettingsDto {
    brandTone?: string;
    businessHours?: BusinessHours;
    handoffRules?: HandoffRules;
    supportedLanguages?: string[];
}
