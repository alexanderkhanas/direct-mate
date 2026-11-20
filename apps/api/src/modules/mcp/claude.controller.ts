import { BadRequestException, Body, Controller, Delete, Get, GoneException, HttpCode, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { IntegrationsService } from '../integrations/integrations.service';
import { TelegramService } from '../notifications/telegram.service';
import { HandoffService } from './handoff.service';
import { REQUEST_COOKIE } from './mcp-http.service';
import { OAuthService } from './oauth/oauth.service';

class HandoffDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  token!: string;
}

class ShopifyHandoffDto extends HandoffDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  shopDomain!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  accessToken!: string;
}

function cookie(req: Request, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return decodeURIComponent(value.join('='));
  }
  return undefined;
}

/**
 * What the admin's `/claude/…` pages call: the consent step of a sign-in from
 * Claude, the hand-off links Claude gives for steps that need a browser, and
 * the list of connections an owner can revoke.
 */
@ApiTags('claude')
@Controller('claude')
export class ClaudeController {
  constructor(
    private readonly oauth: OAuthService,
    private readonly handoffs: HandoffService,
    private readonly integrations: IntegrationsService,
    private readonly telegram: TelegramService,
    private readonly config: ConfigService,
  ) {}

  /** Public: the address owners paste into Claude, for the «Set up with Claude» page and the Connections card. */
  @Get('connector')
  connector() {
    const enabled = this.config.get<boolean>('mcp.enabled') === true;
    return { enabled, url: enabled ? `${this.config.get<string>('mcp.publicUrl')}/mcp` : null };
  }

  // ─── Consent ─────────────────────────────────────────────────────

  /** Public: the page shows who is asking before the owner signs in. */
  @Get('requests/:id')
  async request(@Param('id') id: string) {
    const info = await this.oauth.requestInfo(id);
    if (!info) throw new GoneException({ message: 'This sign-in has expired', details: { code: 'expired' } });
    return info;
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Post('requests/:id/approve')
  @HttpCode(200)
  async approve(@Param('id') id: string, @Req() req: Request) {
    // The raw JWT subject, not @CurrentUser: that swaps the tenant for a superadmin's header.
    const userId = (req.user as JwtPayload | undefined)?.sub ?? '';
    const result = await this.oauth.approve(id, userId, cookie(req, REQUEST_COOKIE));
    if ('problem' in result) {
      throw new BadRequestException({ message: 'Could not allow this sign-in', details: { code: result.problem } });
    }
    return result;
  }

  /** Public: closing a request needs no more than knowing it, and only tells the client «no». */
  @Post('requests/:id/deny')
  @HttpCode(200)
  async deny(@Param('id') id: string) {
    const result = await this.oauth.deny(id);
    if (!result) throw new GoneException({ message: 'This sign-in has expired', details: { code: 'expired' } });
    return result;
  }

  // ─── Hand-off links ──────────────────────────────────────────────
  // Public: the one-time token in the link is the authorization, for that
  // store and that action only.

  @Post('handoff/instagram')
  @HttpCode(200)
  async instagram(@Body() dto: HandoffDto) {
    const tenantId = await this.handoffs.consume(dto.token, 'instagram');
    if (!tenantId) throw new GoneException({ message: 'This link has expired', details: { code: 'expired' } });
    return { redirectUrl: await this.integrations.instagramLoginUrl(tenantId, 'claude') };
  }

  @Post('handoff/shopify')
  @HttpCode(200)
  async shopify(@Body() dto: ShopifyHandoffDto) {
    const shopDomain = dto.shopDomain.trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '').toLowerCase();
    if (!/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/.test(shopDomain)) {
      // Checked before the link is spent, so a typo doesn't cost the owner the link.
      throw new BadRequestException({ message: 'Not a shop address', details: { code: 'bad_domain' } });
    }
    const tenantId = await this.handoffs.consume(dto.token, 'shopify');
    if (!tenantId) throw new GoneException({ message: 'This link has expired', details: { code: 'expired' } });
    await this.integrations.connectShopify(tenantId, shopDomain, dto.accessToken.trim());
    // Products arrive through the operator-run n8n sync; a self-serve store needs someone to start it.
    void this.telegram.notifyPlatform(`🛍 Shopify підключено через Claude: ${shopDomain} — запустіть синхронізацію товарів`);
    return { ok: true };
  }

  // ─── Connections the owner allowed ───────────────────────────────

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Get('grants')
  grants(@CurrentUser() user: JwtPayload) {
    return this.oauth.grants(user.tenantId);
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Delete('grants/:id')
  async revoke(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return { revoked: await this.oauth.revokeGrant(id, user.tenantId) };
  }
}
