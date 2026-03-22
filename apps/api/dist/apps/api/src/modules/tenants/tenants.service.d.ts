import { Repository } from 'typeorm';
import { Tenant } from './entities/tenant.entity';
import { TenantSettings } from './entities/tenant-settings.entity';
export declare class TenantsService {
    private readonly tenantRepo;
    private readonly settingsRepo;
    constructor(tenantRepo: Repository<Tenant>, settingsRepo: Repository<TenantSettings>);
    findById(id: string): Promise<Tenant>;
    getSettings(tenantId: string): Promise<TenantSettings | null>;
}
