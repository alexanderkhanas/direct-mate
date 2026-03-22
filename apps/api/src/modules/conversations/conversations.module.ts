import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Conversation } from './entities/conversation.entity';
import { Customer } from './entities/customer.entity';
import { Message } from './entities/message.entity';
import { ConversationState } from './entities/conversation-state.entity';
import { TenantSettings } from '../tenants/entities/tenant-settings.entity';
import { ManagerExample } from '../settings/entities/manager-example.entity';
import { ConversationsService } from './conversations.service';
import { ReplyEngineService } from './reply-engine.service';
import { ConversationsController } from './conversations.controller';
import { ConversationReplyController } from './conversation-reply.controller';
import { AvailabilityModule } from '../availability/availability.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Conversation,
      Customer,
      Message,
      ConversationState,
      TenantSettings,
      ManagerExample,
    ]),
    AvailabilityModule,
    AuditModule,
  ],
  controllers: [ConversationsController, ConversationReplyController],
  providers: [ConversationsService, ReplyEngineService],
  exports: [ConversationsService, ReplyEngineService],
})
export class ConversationsModule {}
