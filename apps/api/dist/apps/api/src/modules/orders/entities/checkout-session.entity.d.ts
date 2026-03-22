import { CheckoutSessionStatus } from '@direct-mate/shared';
import { CheckoutItem } from './checkout-item.entity';
import { CheckoutCustomerInfo } from './checkout-customer-info.entity';
export declare class CheckoutSession {
    id: string;
    tenantId: string;
    conversationId: string;
    customerId: string;
    status: CheckoutSessionStatus;
    reservationId: string | null;
    expiresAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    items: CheckoutItem[];
    customerInfo: CheckoutCustomerInfo;
}
