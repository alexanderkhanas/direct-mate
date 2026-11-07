import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Connection } from '../integrations/entities/connection.entity';
import { IntegrationsModule } from '../integrations/integrations.module';
import { CatalogModule } from '../catalog/catalog.module';
import { AgentModule } from '../agent/agent.module';
import { CatalogFeedsController } from './catalog-feeds.controller';
import { FeedSyncService } from './feed-sync.service';

@Module({
  imports: [TypeOrmModule.forFeature([Connection]), IntegrationsModule, CatalogModule, AgentModule],
  controllers: [CatalogFeedsController],
  providers: [FeedSyncService],
  exports: [FeedSyncService],
})
export class CatalogFeedsModule {}
