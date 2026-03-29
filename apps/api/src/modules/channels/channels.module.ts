import { Module } from '@nestjs/common';
import { InstagramController } from './instagram/instagram.controller';
import { InstagramService } from './instagram/instagram.service';
import { ConversationsModule } from '../conversations/conversations.module';
import { IntegrationsModule } from '../integrations/integrations.module';
import { OrdersModule } from '../orders/orders.module';
import { CryptoService } from '../../common/crypto.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { InstagramContentModule } from './instagram/instagram-content.module';

@Module({
  imports: [ConversationsModule, IntegrationsModule, OrdersModule, NotificationsModule, InstagramContentModule],
  controllers: [InstagramController],
  providers: [InstagramService, CryptoService],
})
export class ChannelsModule {}
