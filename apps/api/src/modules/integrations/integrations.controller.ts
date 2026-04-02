import { Body, Controller, Delete, Get, Param, Post, Query, Res, UseGuards, BadRequestException, ForbiddenException, NotFoundException, Logger } from '@nestjs/common';
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
    const redirectUri = this.config.get<string>('meta.oauthRedirectUri');
    if (!appId || !redirectUri) {
      throw new BadRequestException('Instagram OAuth not configured');
    }

    // Generate state token and save to DB (reuse telegram_connect_tokens table)
    const state = await this.integrationsService.createOAuthState(user.tenantId);

    const scopes = [
      'instagram_business_basic',
      'instagram_business_manage_messages',
      'instagram_business_content_publish',
      'instagram_business_manage_comments',
    ].join(',');

    const redirectUrl = `https://www.instagram.com/oauth/authorize?client_id=${appId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${scopes}&response_type=code&state=${state}`;

    return { redirectUrl };
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

      // Exchange code for token
      const { accessToken, userId } = await this.integrationsService.exchangeCodeForToken(code);

      // Fetch Business Account ID + username from Graph API
      // OAuth returns IGSID, but webhooks use Business Account ID — they're different
      let businessAccountId = userId;
      let username: string | undefined;
      try {
        const profileRes = await fetch(`https://graph.instagram.com/me?fields=user_id,username&access_token=${accessToken}`);
        if (profileRes.ok) {
          const profile = await profileRes.json() as { user_id?: number; username?: string };
          if (profile.user_id) businessAccountId = String(profile.user_id);
          username = profile.username;
        }
      } catch { /* non-critical */ }

      // Connect using Business Account ID (matches webhook entry.id)
      await this.integrationsService.connectInstagram(tenantId, businessAccountId, accessToken, username);

      this.logger.log(`Instagram OAuth connected for tenant ${tenantId}, user ${userId}`);
      return res.redirect(`${adminBaseUrl}/connections?instagram=connected`);
    } catch (err) {
      this.logger.error('Instagram OAuth callback failed', (err as Error).message);
      return res.redirect(`${adminBaseUrl}/connections?instagram=error&reason=exchange_failed`);
    }
  }
}
