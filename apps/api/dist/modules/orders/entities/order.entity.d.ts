import { OrderStatus } from '@direct-mate/shared';
import { OrderItem } from './order-item.entity';
export declare class Order {
    id: string;
    tenantId: string;
    checkoutSessionId: string | null;
    customerId: string;
    externalOrderId: string | null;
    status: OrderStatus;
    totalAmount: number | null;
    currency: string;
    source: string;
    externalSyncStatus: string;
    externalOrderMetadata: Record<string, unknown> | null;
    externalSyncTriggeredAt: Date | null;
    externalSyncCompletedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    items: OrderItem[];
}
