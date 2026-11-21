import { Module } from '@nestjs/common';
import { CatalogFeedsModule } from '../catalog-feeds/catalog-feeds.module';
import { EngineModule } from '../engine/engine.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { OnboardingModule } from '../onboarding/onboarding.module';
import { SettingsModule } from '../settings/settings.module';
import { SizeChartsModule } from '../size-charts/size-charts.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { HandoffService } from './handoff.service';
import { McpHttpService } from './mcp-http.service';
import { McpToolsService } from './mcp-tools.service';
import { SetupEventsModule } from './setup-events.module';
import { ClaudeController } from './claude.controller';
import { OAuthService } from './oauth/oauth.service';
import { IntegrationsModule } from '../integrations/integrations.module';

/**
 * The Claude connector: a remote MCP server through which a shop owner sets
 * up their AI agent by talking to Claude. The tools wrap the same services
 * the admin setup uses, so both write the same store.
 * `main.ts` mounts `McpHttpService.router()` (OAuth and MCP endpoints) when
 * `MCP_ENABLED=true`; `ClaudeController` serves the admin's `/claude/…` pages.
 */
@Module({
  imports: [
    OnboardingModule,
    EngineModule,
    CatalogFeedsModule,
    IntegrationsModule,
    NotificationsModule,
    SettingsModule,
    SizeChartsModule,
    SubscriptionsModule,
    SetupEventsModule,
  ],
  controllers: [ClaudeController],
  providers: [McpHttpService, McpToolsService, HandoffService, OAuthService],
  exports: [McpHttpService],
})
export class McpModule {}
