import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InstagramController } from './instagram/instagram.controller';
import { InstagramService } from './instagram/instagram.service';
import { InstagramCommentService } from './instagram/instagram-comment.service';
import { ConversationsModule } from '../conversations/conversations.module';
import { IntegrationsModule } from '../integrations/integrations.module';
import { OrdersModule } from '../orders/orders.module';
import { CryptoService } from '../../common/crypto.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { InstagramContentModule } from './instagram/instagram-content.module';
import { PendingMessage } from './instagram/entities/pending-message.entity';
import { Conversation } from '../conversations/entities/conversation.entity';
import { StoreConfig } from '../engine/entities/store-config.entity';
import { ScreenshotTrainingModule } from '../screenshot-training/screenshot-training.module';
import { EngineModule } from '../engine/engine.module';
import { AvailabilityModule } from '../availability/availability.module';
import { SizeChartsModule } from '../size-charts/size-charts.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([PendingMessage, Conversation, StoreConfig]),
    ConversationsModule, IntegrationsModule, OrdersModule, NotificationsModule,
    InstagramContentModule, ScreenshotTrainingModule,
    EngineModule, AvailabilityModule, SizeChartsModule,
  ],
  controllers: [InstagramController],
  providers: [InstagramService, InstagramCommentService, CryptoService],
})
export class ChannelsModule {}
