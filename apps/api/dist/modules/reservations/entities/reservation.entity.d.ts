import { ReservationStatus } from '@direct-mate/shared';
export declare class Reservation {
    id: string;
    tenantId: string;
    conversationId: string;
    customerId: string;
    variantId: string;
    qty: number;
    status: ReservationStatus;
    expiresAt: Date;
    createdAt: Date;
    updatedAt: Date;
}
