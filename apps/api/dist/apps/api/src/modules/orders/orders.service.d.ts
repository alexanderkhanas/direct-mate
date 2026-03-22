import { Repository } from 'typeorm';
import { Order } from './entities/order.entity';
import { OrderItem } from './entities/order-item.entity';
import { CheckoutSession } from './entities/checkout-session.entity';
export declare class OrdersService {
    private readonly orderRepo;
    private readonly orderItemRepo;
    private readonly sessionRepo;
    constructor(orderRepo: Repository<Order>, orderItemRepo: Repository<OrderItem>, sessionRepo: Repository<CheckoutSession>);
    createDraft(checkoutSessionId: string): Promise<Order>;
    findAll(tenantId: string): Promise<Order[]>;
    findById(id: string): Promise<Order>;
}
