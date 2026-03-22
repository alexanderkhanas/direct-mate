import { UserRole } from '@direct-mate/shared';
import { Tenant } from './tenant.entity';
export declare class User {
    id: string;
    tenantId: string;
    email: string;
    passwordHash: string;
    role: UserRole;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
    tenant: Tenant;
}
