import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SubscriptionPlan } from './entities/subscription-plan.entity';
import { SubscriptionUsage } from './entities/subscription-usage.entity';
import { SubscriptionPlanConfig } from './entities/subscription-plan-config.entity';
import { SubscriptionsService } from './subscriptions.service';
import { SubscriptionsController } from './subscriptions.controller';
import { MonoPaymentService } from './mono-payment.service';

@Module({
  imports: [TypeOrmModule.forFeature([SubscriptionPlan, SubscriptionUsage, SubscriptionPlanConfig])],
  controllers: [SubscriptionsController],
  providers: [SubscriptionsService, MonoPaymentService],
  exports: [SubscriptionsService],
})
export class SubscriptionsModule {}
