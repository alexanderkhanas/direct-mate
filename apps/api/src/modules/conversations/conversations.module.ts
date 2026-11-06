import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Conversation } from './entities/conversation.entity';
import { Customer } from './entities/customer.entity';
import { Message } from './entities/message.entity';
import { ConversationState } from './entities/conversation-state.entity';
import { ConversationTrace } from './entities/conversation-trace.entity';
import { TenantSettings } from '../tenants/entities/tenant-settings.entity';
import { ManagerExample } from '../settings/entities/manager-example.entity';
import { StoreConfig } from '../engine/entities/store-config.entity';
import { Product } from '../catalog/entities/product.entity';
import { ConversationsService } from './conversations.service';
import { ConversationTracesService } from './conversation-traces.service';
import { ReplyEngineService } from './reply-engine.service';
import { ConversationsController } from './conversations.controller';
import { ConversationReplyController } from './conversation-reply.controller';
import { AvailabilityModule } from '../availability/availability.module';
import { AuditModule } from '../audit/audit.module';
import { EngineModule } from '../engine/engine.module';
import { InstagramContentModule } from '../channels/instagram/instagram-content.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { SizeChartsModule } from '../size-charts/size-charts.module';
import { AgentModule } from '../agent/agent.module';
import { OrdersModule } from '../orders/orders.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { TurnRunner } from './turn-runner.service';
import { HistoryBuilder } from './history.builder';
import { MediaContextResolver } from './media-context.resolver';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Conversation,
      Customer,
      Message,
      ConversationState,
      ConversationTrace,
      TenantSettings,
      ManagerExample,
      StoreConfig,
      Product,
    ]),
    AvailabilityModule,
    AuditModule,
    EngineModule,
    InstagramContentModule,
    SubscriptionsModule,
    SizeChartsModule,
    AgentModule,
    OrdersModule,
    NotificationsModule,
  ],
  controllers: [ConversationsController, ConversationReplyController],
  providers: [
    ConversationsService,
    ConversationTracesService,
    ReplyEngineService,
    TurnRunner,
    HistoryBuilder,
    MediaContextResolver,
  ],
  exports: [ConversationsService, ConversationTracesService, ReplyEngineService, TurnRunner],
})
export class ConversationsModule {}
