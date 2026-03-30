import { Module } from '@nestjs/common';
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
    ]),
  ],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
