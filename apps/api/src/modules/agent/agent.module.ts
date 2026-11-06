import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AvailabilityModule } from '../availability/availability.module';
import { CustomerMediaModule } from '../customer-media/customer-media.module';
import { OrdersModule } from '../orders/orders.module';
import { SizeChartsModule } from '../size-charts/size-charts.module';
import { StoreConfig } from '../engine/entities/store-config.entity';
import { TenantSettings } from '../tenants/entities/tenant-settings.entity';
import { Tenant } from '../tenants/entities/tenant.entity';
import { ManagerExample } from '../settings/entities/manager-example.entity';
import { AgentService } from './agent.service';
import { AgentModelFactory } from './model.factory';
import { AgentStoreSettingsService } from './store-settings.service';
import { CatalogReader } from './catalog/catalog-reader.service';
import { CatalogIndexService } from './catalog/catalog-index.service';
import { CATALOG_SEARCH, RankedCatalogSearch } from './catalog/catalog-search';

/**
 * The v2 tool-calling agent (docs/v2-agent). Callers use `AgentService.runTurn`
 * and carry out the returned effects themselves.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([StoreConfig, TenantSettings, Tenant, ManagerExample]),
    AvailabilityModule,
    CustomerMediaModule,
    OrdersModule,
    SizeChartsModule,
  ],
  providers: [
    AgentService,
    AgentModelFactory,
    AgentStoreSettingsService,
    CatalogReader,
    CatalogIndexService,
    { provide: CATALOG_SEARCH, useClass: RankedCatalogSearch },
  ],
  exports: [AgentService, AgentStoreSettingsService, CatalogIndexService],
})
export class AgentModule {}
