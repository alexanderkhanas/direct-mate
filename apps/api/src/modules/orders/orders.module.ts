import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CheckoutSession } from './entities/checkout-session.entity';
import { CheckoutItem } from './entities/checkout-item.entity';
import { CheckoutCustomerInfo } from './entities/checkout-customer-info.entity';
import { Order } from './entities/order.entity';
import { OrderItem } from './entities/order-item.entity';
import { ProductVariant } from '../catalog/entities/product-variant.entity';
import { TenantSettings } from '../tenants/entities/tenant-settings.entity';
import { OrdersService } from './orders.service';
import { CheckoutService } from './checkout.service';
import { OrdersController } from './orders.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      CheckoutSession,
      CheckoutItem,
      CheckoutCustomerInfo,
      Order,
      OrderItem,
      ProductVariant,
      TenantSettings,
    ]),
  ],
  controllers: [OrdersController],
  providers: [OrdersService, CheckoutService],
  exports: [OrdersService, CheckoutService],
})
export class OrdersModule {}
