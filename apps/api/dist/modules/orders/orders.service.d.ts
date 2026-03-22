import { Repository } from 'typeorm';
import { Order } from './entities/order.entity';
import { OrderItem } from './entities/order-item.entity';
import { CheckoutSession } from './entities/checkout-session.entity';
import { TenantSettings } from '../tenants/entities/tenant-settings.entity';
export declare class OrdersService {
    private readonly orderRepo;
    private readonly orderItemRepo;
    private readonly sessionRepo;
    private readonly settingsRepo;
    private readonly logger;
    constructor(orderRepo: Repository<Order>, orderItemRepo: Repository<OrderItem>, sessionRepo: Repository<CheckoutSession>, settingsRepo: Repository<TenantSettings>);
    createDraft(checkoutSessionId: string): Promise<Order>;
    private notifyManager;
    findAll(tenantId: string): Promise<Order[]>;
    findById(id: string): Promise<Order>;
}
