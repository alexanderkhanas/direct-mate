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
    createdAt: Date;
    updatedAt: Date;
    items: OrderItem[];
}
