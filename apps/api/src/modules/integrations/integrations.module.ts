import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Connection } from './entities/connection.entity';
import { SyncJob } from './entities/sync-job.entity';
import { IntegrationsService } from './integrations.service';
import { IntegrationsController } from './integrations.controller';
import { CryptoService } from '../../common/crypto.service';

@Module({
  imports: [TypeOrmModule.forFeature([Connection, SyncJob])],
  controllers: [IntegrationsController],
  providers: [IntegrationsService, CryptoService],
  exports: [IntegrationsService],
})
export class IntegrationsModule {}
