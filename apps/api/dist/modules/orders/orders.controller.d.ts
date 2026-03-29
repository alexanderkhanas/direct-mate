import { JwtPayload } from '../../common/decorators/current-user.decorator';
import { OrdersService } from './orders.service';
import { CheckoutService } from './checkout.service';
import { StartCheckoutDto } from './dto/start-checkout.dto';
import { CustomerInfoDto } from './dto/customer-info.dto';
import { SyncCallbackDto } from './dto/sync-callback.dto';
import { OrderStatus } from '@direct-mate/shared';
export declare class OrdersController {
    private readonly ordersService;
    private readonly checkoutService;
    constructor(ordersService: OrdersService, checkoutService: CheckoutService);
    startCheckout(user: JwtPayload, dto: StartCheckoutDto): Promise<import("./entities/checkout-session.entity").CheckoutSession>;
    saveCustomerInfo(id: string, dto: CustomerInfoDto): Promise<import("./entities/checkout-session.entity").CheckoutSession>;
    createDraft(body: {
        checkoutSessionId: string;
    }): Promise<import("./entities/order.entity").Order>;
    listOrders(user: JwtPayload): Promise<any[]>;
    getOrder(id: string): Promise<any>;
    updateStatus(user: JwtPayload, id: string, body: {
        status: OrderStatus;
    }): Promise<import("./entities/order.entity").Order>;
    handleSyncCallback(orderId: string, callback: SyncCallbackDto): Promise<void>;
}
