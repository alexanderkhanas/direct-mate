import { Module } from '@nestjs/common';
import { InstagramController } from './instagram/instagram.controller';
import { InstagramService } from './instagram/instagram.service';
import { ConversationsModule } from '../conversations/conversations.module';
import { IntegrationsModule } from '../integrations/integrations.module';
import { OrdersModule } from '../orders/orders.module';
import { CryptoService } from '../../common/crypto.service';

@Module({
  imports: [ConversationsModule, IntegrationsModule, OrdersModule],
  controllers: [InstagramController],
  providers: [InstagramService, CryptoService],
})
export class ChannelsModule {}
