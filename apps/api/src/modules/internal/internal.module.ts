import { Module } from '@nestjs/common';
import { InternalController } from './internal.controller';
import { IntegrationsModule } from '../integrations/integrations.module';
import { CatalogModule } from '../catalog/catalog.module';

@Module({
  imports: [IntegrationsModule, CatalogModule],
  controllers: [InternalController],
})
export class InternalModule {}
