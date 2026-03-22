import { Repository } from 'typeorm';
import { TenantSettings } from '../tenants/entities/tenant-settings.entity';
import { ManagerExample } from './entities/manager-example.entity';
import { UpdateSettingsDto } from './dto/update-settings.dto';
export declare class SettingsService {
    private readonly settingsRepo;
    private readonly examplesRepo;
    constructor(settingsRepo: Repository<TenantSettings>, examplesRepo: Repository<ManagerExample>);
    getSettings(tenantId: string): Promise<TenantSettings | null>;
    updateSettings(tenantId: string, dto: UpdateSettingsDto): Promise<{
        success: boolean;
    }>;
    getExamples(tenantId: string): Promise<ManagerExample[]>;
    createExample(tenantId: string, data: Pick<ManagerExample, 'customerMessage' | 'managerReply' | 'scenario' | 'tags'>): Promise<ManagerExample>;
    deleteExample(id: string): Promise<{
        success: boolean;
    }>;
}
