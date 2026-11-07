import { Body, Controller, Delete, Get, Param, Post, Query, Res, UseGuards, BadRequestException, ForbiddenException, NotFoundException, Logger } from '@nestjs/common';
import { ConnectionType } from '@direct-mate/shared';
import { ApiBearerAuth, ApiProperty, ApiTags } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { IsNotEmpty, IsOptional, IsString, IsIn } from 'class-validator';
import { Response } from 'express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { InternalApiKeyGuard } from '../../common/guards/internal-api-key.guard';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';
import { IntegrationsService } from './integrations.service';

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
  constructor(private readonly integrationsService: IntegrationsService) {}

  @Get()
  findAll(@CurrentUser() user: JwtPayload) {
    return this.integrationsService.findAll(user.tenantId);
  }

  @Post('instagram')
  connectInstagram(
    @CurrentUser() user: JwtPayload,
    @Body() dto: ConnectInstagramDto,
  ) {
    return this.integrationsService.connectInstagram(
      user.tenantId,
      dto.pageId,
      dto.accessToken,
      dto.accountName,
    );
  }

  @Post('shopify')
  connectShopify(
    @CurrentUser() user: JwtPayload,
    @Body() dto: ConnectShopifyDto,
  ) {
    return this.integrationsService.connectShopify(
      user.tenantId,
      dto.shopDomain,
      dto.accessToken,
      dto.shopName,
    );
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
  ) {}

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Post('connections/instagram/oauth/start')
  async start(@CurrentUser() user: JwtPayload) {
    const appId = this.config.get<string>('meta.appId');
    const configId = this.config.get<string>('meta.loginConfigId');
    const redirectUri = this.config.get<string>('meta.oauthRedirectUri');
    if (!appId || !configId || !redirectUri) {
      throw new BadRequestException('Instagram OAuth not configured');
    }

    // Generate state token and save to DB (reuse telegram_connect_tokens table)
    const state = await this.integrationsService.createOAuthState(user.tenantId);

    // The Unified Login URL from the App Dashboard. The configuration carries
    // the permissions, so no scopes here. Its `display=popup` is dropped: the
    // admin opens this as a full page.
    const params = new URLSearchParams({
      client_id: appId,
      config_id: configId,
      redirect_uri: redirectUri,
      response_type: 'code',
      override_default_response_type: 'true',
      state,
      prompt: 'login',
    });

    return { redirectUrl: `https://www.facebook.com/dialog/oauth?${params}` };
  }

  @Get('auth/instagram/callback')
  async callback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Res() res: Response,
  ) {
    const adminBaseUrl = this.config.get<string>('admin.baseUrl') ?? 'http://localhost:5173';

    if (!code || !state) {
      return res.redirect(`${adminBaseUrl}/connections?instagram=error&reason=missing_params`);
    }

    try {
      // Validate state and get tenantId
      const tenantId = await this.integrationsService.validateOAuthState(state);
      if (!tenantId) {
        return res.redirect(`${adminBaseUrl}/connections?instagram=error&reason=invalid_state`);
      }

      const { accessToken, expiresAt } = await this.integrationsService.exchangeCodeForToken(code);

      // One token can cover several accounts; a tenant is one account. Picking
      // one for the store could wire the wrong account, so ask them to
      // reconnect sharing just one.
      const accounts = await this.integrationsService.getAssignedInstagramAccounts(accessToken);
      if (accounts.length !== 1) {
        const reason = accounts.length === 0 ? 'no_account' : 'multiple_accounts';
        this.logger.warn(`Instagram OAuth for tenant ${tenantId}: ${accounts.length} accounts shared — ${reason}`);
        return res.redirect(`${adminBaseUrl}/connections?instagram=error&reason=${reason}`);
      }
      const [account] = accounts;

      try {
        await this.integrationsService.subscribeToWebhooks(account.id, accessToken);
      } catch (err) {
        // Saving now would show a connected account that never hears a message.
        this.logger.error(`Instagram OAuth for tenant ${tenantId}`, (err as Error).message);
        return res.redirect(`${adminBaseUrl}/connections?instagram=error&reason=subscribe_failed`);
      }

      // The account id is what webhooks put in entry.id.
      await this.integrationsService.connectInstagram(tenantId, account.id, accessToken, account.username, expiresAt);

      this.logger.log(`Instagram OAuth connected for tenant ${tenantId}, account ${account.id}`);
      return res.redirect(`${adminBaseUrl}/connections?instagram=connected`);
    } catch (err) {
      this.logger.error('Instagram OAuth callback failed', (err as Error).message);
      return res.redirect(`${adminBaseUrl}/connections?instagram=error&reason=exchange_failed`);
    }
  }
}
