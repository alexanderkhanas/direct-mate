import { Module } from '@nestjs/common';
import { InternalController } from './internal.controller';
import { IntegrationsModule } from '../integrations/integrations.module';
import { CatalogModule } from '../catalog/catalog.module';
import { AgentModule } from '../agent/agent.module';

@Module({
  imports: [IntegrationsModule, CatalogModule, AgentModule],
  controllers: [InternalController],
})
export class InternalModule {}
