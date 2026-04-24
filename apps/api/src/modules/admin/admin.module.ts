import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { Tenant } from '../tenants/entities/tenant.entity';
import { User } from '../tenants/entities/user.entity';
import { Conversation } from '../conversations/entities/conversation.entity';
import { Customer } from '../conversations/entities/customer.entity';
import { Order } from '../orders/entities/order.entity';
import { Connection } from '../integrations/entities/connection.entity';
import { Message } from '../conversations/entities/message.entity';
import { SubscriptionPlan } from '../subscriptions/entities/subscription-plan.entity';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Tenant,
      User,
      Conversation,
      Customer,
      Order,
      Connection,
      Message,
      SubscriptionPlan,
    ]),
    SubscriptionsModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('jwt.secret'),
        signOptions: { expiresIn: '2h' },
      }),
    }),
  ],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
