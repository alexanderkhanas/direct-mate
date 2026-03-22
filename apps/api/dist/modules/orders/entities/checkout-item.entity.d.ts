import { CheckoutSession } from './checkout-session.entity';
export declare class CheckoutItem {
    id: string;
    checkoutSessionId: string;
    productId: string;
    variantId: string;
    qty: number;
    unitPrice: number;
    currency: string;
    createdAt: Date;
    checkoutSession: CheckoutSession;
}
