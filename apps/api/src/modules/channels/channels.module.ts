import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InstagramController } from './instagram/instagram.controller';
import { InstagramService } from './instagram/instagram.service';
import { InstagramCommentService } from './instagram/instagram-comment.service';
import { ConversationsModule } from '../conversations/conversations.module';
import { IntegrationsModule } from '../integrations/integrations.module';
import { CryptoService } from '../../common/crypto.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { InstagramContentModule } from './instagram/instagram-content.module';
import { Conversation } from '../conversations/entities/conversation.entity';
import { StoreConfig } from '../engine/entities/store-config.entity';
import { ScreenshotTrainingModule } from '../screenshot-training/screenshot-training.module';
import { EngineModule } from '../engine/engine.module';
import { AvailabilityModule } from '../availability/availability.module';
import { SizeChartsModule } from '../size-charts/size-charts.module';
import { AgentModule } from '../agent/agent.module';
import { CustomerMediaModule } from '../customer-media/customer-media.module';
import { InstagramSender } from './instagram/instagram-sender.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Conversation, StoreConfig]),
    ConversationsModule, IntegrationsModule, NotificationsModule,
    InstagramContentModule, ScreenshotTrainingModule,
    EngineModule, AvailabilityModule, SizeChartsModule,
    AgentModule, CustomerMediaModule,
  ],
  controllers: [InstagramController],
  providers: [InstagramService, InstagramCommentService, InstagramSender, CryptoService],
})
export class ChannelsModule {}
