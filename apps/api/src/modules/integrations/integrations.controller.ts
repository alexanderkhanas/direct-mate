import { Body, Controller, Delete, Get, Param, Post, Query, Res, UseGuards, BadRequestException, ForbiddenException, NotFoundException, Logger } from '@nestjs/common';
import { ConnectionType } from '@direct-mate/shared';
import { ApiBearerAuth, ApiProperty, ApiTags } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { IsNotEmpty, IsOptional, IsString, IsIn } from 'class-validator';
import { Response } from 'express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { InternalApiKeyGuard } from '../../common/guards/internal-api-key.guard';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';
import { IntegrationsService, withoutTokens } from './integrations.service';
import { TelegramService } from '../notifications/telegram.service';
import { SetupEventsService } from '../mcp/setup-events.service';
import type { InstagramLoginMethod } from '../../common/meta-graph';

class ConnectInstagramDto {
  @ApiProperty({ example: '123456789' })
  @IsString()
  @IsNotEmpty()
  pageId!: string;

  @ApiProperty({ example: 'EAABwzLix...' })
  @IsString()
  @IsNotEmpty()
  accessToken!: string;

  @ApiProperty({ example: 'My Store', required: false })
  @IsString()
  @IsOptional()
  accountName?: string;
}

class ConnectShopifyDto {
  @ApiProperty({ example: 'my-store.myshopify.com' })
  @IsString()
  @IsNotEmpty()
  shopDomain!: string;

  @ApiProperty({ example: 'shpat_xxxxx' })
  @IsString()
  @IsNotEmpty()
  accessToken!: string;

  @ApiProperty({ example: 'My Fashion Store', required: false })
  @IsString()
  @IsOptional()
  shopName?: string;
}

@ApiTags('connections')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
@Controller('connections')
export class IntegrationsController {
  constructor(
    private readonly integrationsService: IntegrationsService,
    private readonly telegram: TelegramService,
  ) {}

  @Get()
  findAll(@CurrentUser() user: JwtPayload) {
    return this.integrationsService.findAll(user.tenantId);
  }

  /** Which login «Connect Instagram» opens, so the admin describes the right one. */
  @Get('instagram/login-method')
  instagramLoginMethod() {
    return { method: this.integrationsService.loginMethod() };
  }

  @Post('instagram')
  async connectInstagram(
    @CurrentUser() user: JwtPayload,
    @Body() dto: ConnectInstagramDto,
  ) {
    const connection = await this.integrationsService.connectInstagram(
      user.tenantId,
      dto.pageId,
      dto.accessToken,
      dto.accountName,
    );
    return withoutTokens(connection);
  }

  @Post('shopify')
  async connectShopify(
    @CurrentUser() user: JwtPayload,
    @Body() dto: ConnectShopifyDto,
  ) {
    const connection = await this.integrationsService.connectShopify(
      user.tenantId,
      dto.shopDomain,
      dto.accessToken,
      dto.shopName,
    );
    // Products arrive through the operator-run n8n sync; a self-serve store needs someone to start it.
    void this.telegram.notifyPlatform(`🛍 Shopify підключено: ${dto.shopDomain} (${user.email}) — запустіть синхронізацію товарів`);
    return withoutTokens(connection);
  }

  @Post(':id/disconnect')
  disconnect(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.integrationsService.disconnect(id, user.tenantId);
  }

  @Delete(':id')
  remove(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.integrationsService.remove(id, user.tenantId);
  }
}

// ─── Resolve Credentials DTO ────────────────────────────────

class ResolveCredentialsDto {
  @IsString()
  @IsNotEmpty()
  connectionId!: string;

  @IsString()
  @IsNotEmpty()
  tenantId!: string;

  @IsString()
  @IsNotEmpty()
  platform!: string;

  @IsString()
  @IsNotEmpty()
  purpose!: string;
}

// ─── Internal Controller (server-to-server, no user auth) ───

@ApiTags('internal/connections')
@UseGuards(InternalApiKeyGuard)
@Controller('internal/connections')
export class InternalConnectionsController {
  constructor(private readonly integrationsService: IntegrationsService) {}

  @Post('resolve-credentials')
  async resolveCredentials(@Body() dto: ResolveCredentialsDto) {
    return this.integrationsService.resolveCredentials(dto);
  }

  @Get('shopify')
  async listShopifyConnections() {
    return this.integrationsService.findAllByType(ConnectionType.Shopify);
  }
}

// ─── Instagram OAuth Controller ─────────────────────────────

@ApiTags('connections')
@Controller()
export class InstagramOAuthController {
  private readonly logger = new Logger(InstagramOAuthController.name);

  constructor(
    private readonly integrationsService: IntegrationsService,
    private readonly config: ConfigService,
    private readonly setupEvents: SetupEventsService,
  ) {}

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Post('connections/instagram/oauth/start')
  async start(@CurrentUser() user: JwtPayload, @Body() body: { returnTo?: string } = {}) {
    const returnTo = body?.returnTo === 'onboarding' ? 'onboarding' : 'connections';
    return { redirectUrl: await this.integrationsService.instagramLoginUrl(user.tenantId, returnTo) };
  }

  @Get('auth/instagram/callback')
  async callback(
    @Query('code') code: string,
    @Query('state') rawState: string,
    @Query('error') error: string,
    @Res() res: Response,
  ) {
    const adminBaseUrl = this.config.get<string>('admin.baseUrl') ?? 'http://localhost:5173';
    const [state, returnKey, methodKey] = (rawState ?? '').split('.');
    // Only the pages that start a connection; never a URL from the query.
    const fromClaude = returnKey === 'claude';
    const path =
      fromClaude ? 'claude/done' : returnKey === 'link' ? 'connect/done' : returnKey === 'onboarding' ? 'onboarding' : 'connections';
    const page = `${adminBaseUrl}/${path}`;
    // The login the state was issued for; a state without one predates the choice.
    const method: InstagramLoginMethod = methodKey === 'ig' ? 'instagram' : 'unified';

    if (!code || !state) {
      // Both logins send `error=access_denied` when the owner closes or declines.
      const reason = error === 'access_denied' ? 'cancelled' : 'missing_params';
      return res.redirect(`${page}?instagram=error&reason=${reason}`);
    }

    try {
      // Validate state and get tenantId
      const tenantId = await this.integrationsService.validateOAuthState(state);
      if (!tenantId) {
        return res.redirect(`${page}?instagram=error&reason=invalid_state`);
      }

      const result = await this.integrationsService.completeInstagramLogin(tenantId, code, method);
      if (!result.ok) return res.redirect(`${page}?instagram=error&reason=${result.reason}`);

      this.logger.log(`Instagram OAuth (${method}) connected for tenant ${tenantId}, account ${result.accountId}`);
      if (fromClaude) await this.setupEvents.record(tenantId, 'instagram_connected');
      return res.redirect(`${page}?instagram=connected`);
    } catch (err) {
      this.logger.error('Instagram OAuth callback failed', (err as Error).message);
      return res.redirect(`${page}?instagram=error&reason=exchange_failed`);
    }
  }
}
