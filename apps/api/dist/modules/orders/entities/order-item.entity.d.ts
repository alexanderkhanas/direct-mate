import { Order } from './order.entity';
export declare class OrderItem {
    id: string;
    orderId: string;
    productId: string;
    variantId: string;
    qty: number;
    unitPrice: number;
    currency: string;
    createdAt: Date;
    order: Order;
}
