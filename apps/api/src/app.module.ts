import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { DatabaseModule } from './database/database.module';
import configuration from './config/configuration';
import { validationSchema } from './config/validation.schema';
import { AuthModule } from './modules/auth/auth.module';
import { TenantsModule } from './modules/tenants/tenants.module';
import { ConversationsModule } from './modules/conversations/conversations.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { AvailabilityModule } from './modules/availability/availability.module';
import { ReservationsModule } from './modules/reservations/reservations.module';
import { OrdersModule } from './modules/orders/orders.module';
import { ChannelsModule } from './modules/channels/channels.module';
import { IntegrationsModule } from './modules/integrations/integrations.module';
import { SettingsModule } from './modules/settings/settings.module';
import { AuditModule } from './modules/audit/audit.module';
import { InternalModule } from './modules/internal/internal.module';
import { ScreenshotTrainingModule } from './modules/screenshot-training/screenshot-training.module';
import { EngineModule } from './modules/engine/engine.module';
import { TestingModule } from './modules/testing/testing.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { AdminModule } from './modules/admin/admin.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validationSchema,
      validationOptions: { allowUnknown: true },
    }),
    ScheduleModule.forRoot(),
    DatabaseModule,
    AuthModule,
    TenantsModule,
    ConversationsModule,
    CatalogModule,
    AvailabilityModule,
    ReservationsModule,
    OrdersModule,
    ChannelsModule,
    IntegrationsModule,
    SettingsModule,
    AuditModule,
    InternalModule,
    ScreenshotTrainingModule,
    EngineModule,
    TestingModule,
    NotificationsModule,
    AdminModule,
    AnalyticsModule,
  ],
})
export class AppModule {}
