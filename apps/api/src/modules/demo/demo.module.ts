import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Tenant } from '../tenants/entities/tenant.entity';
import { ConversationsModule } from '../conversations/conversations.module';
import { CatalogModule } from '../catalog/catalog.module';
import { DemoService } from './demo.service';
import { DemoMessageBufferService } from './demo-message-buffer.service';
import { DemoBudgetService } from './demo-budget.service';
import { DemoRateLimiterService } from './demo-rate-limiter.service';
import { DemoController } from './demo.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Tenant]), ConversationsModule, CatalogModule],
  controllers: [DemoController],
  providers: [
    DemoService,
    DemoMessageBufferService,
    DemoBudgetService,
    DemoRateLimiterService,
  ],
})
export class DemoModule {}
