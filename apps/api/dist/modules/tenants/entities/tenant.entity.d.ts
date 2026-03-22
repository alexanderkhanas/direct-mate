import { BusinessType } from '@direct-mate/shared';
import { User } from './user.entity';
import { TenantSettings } from './tenant-settings.entity';
export declare class Tenant {
    id: string;
    name: string;
    slug: string;
    businessType: BusinessType;
    timezone: string;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
    users: User[];
    settings: TenantSettings;
}
