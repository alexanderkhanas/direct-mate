import { Repository } from 'typeorm';
import { CheckoutSession } from './entities/checkout-session.entity';
import { CheckoutItem } from './entities/checkout-item.entity';
import { CheckoutCustomerInfo } from './entities/checkout-customer-info.entity';
import { ProductVariant } from '../catalog/entities/product-variant.entity';
import { StartCheckoutDto } from './dto/start-checkout.dto';
import { CustomerInfoDto } from './dto/customer-info.dto';
export declare class CheckoutService {
    private readonly sessionRepo;
    private readonly itemRepo;
    private readonly infoRepo;
    private readonly variantRepo;
    constructor(sessionRepo: Repository<CheckoutSession>, itemRepo: Repository<CheckoutItem>, infoRepo: Repository<CheckoutCustomerInfo>, variantRepo: Repository<ProductVariant>);
    start(tenantId: string, dto: StartCheckoutDto): Promise<CheckoutSession>;
    saveCustomerInfo(checkoutId: string, dto: CustomerInfoDto): Promise<CheckoutSession>;
    findById(id: string): Promise<CheckoutSession>;
}
