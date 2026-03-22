import { CheckoutSession } from './checkout-session.entity';
export declare class CheckoutCustomerInfo {
    id: string;
    checkoutSessionId: string;
    fullName: string | null;
    phone: string | null;
    city: string | null;
    deliveryProvider: string | null;
    branch: string | null;
    paymentMethod: string | null;
    comment: string | null;
    createdAt: Date;
    updatedAt: Date;
    checkoutSession: CheckoutSession;
}
