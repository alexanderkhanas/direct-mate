import { Body, Controller, Get, GoneException, HttpCode, Post, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Equals, IsBoolean, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ClientIpThrottlerGuard } from '../../common/guards/client-ip-throttler.guard';
import { IntegrationsService } from '../integrations/integrations.service';
import { DirectPermissionsService } from '../onboarding/direct-permissions.service';
import { HandoffService } from './handoff.service';

class ConnectDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  token!: string;

  /** The owner ticked «Allow reading messages»: the link exists for that, so the page can't send without it. */
  @IsBoolean()
  @Equals(true)
  allowRead!: boolean;
}

/**
 * A connect link (`npm run connect-link`): we send it to an owner whose Direct
 * we're asked to analyse before they set anything up, e.g. a prospect. The
 * public page `/connect?t=` says what will happen; the owner allows reading
 * messages (recorded as their own answer, source `link`) and connects
 * Instagram, with no admin login. The token is the authorization, for one
 * store; it works until it expires or the store has Instagram connected, so a
 * cancelled Instagram login can be tried again.
 */
@ApiTags('connect')
@Controller('connect')
@UseGuards(ClientIpThrottlerGuard)
@Throttle({ default: { ttl: 60000, limit: 20 } })
export class ConnectController {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly handoffs: HandoffService,
    private readonly integrations: IntegrationsService,
    private readonly permissions: DirectPermissionsService,
  ) {}

  /** What the page shows: the store's name. Gone when the link expired or Instagram is already connected. */
  @Get()
  async view(@Query('t') token: string) {
    const store = await this.store(token);
    return { storeName: store.name };
  }

  /** The owner's yes to reading, then the Instagram login to send them to. */
  @Post('instagram')
  @HttpCode(200)
  async instagram(@Body() dto: ConnectDto) {
    const store = await this.store(dto.token);
    await this.permissions.set(store.id, 'read_messages', true, { source: 'link' });
    return { redirectUrl: await this.integrations.instagramLoginUrl(store.id, 'link') };
  }

  private async store(token: unknown): Promise<{ id: string; name: string }> {
    const tenantId = await this.handoffs.peek(token, 'connect');
    const [row]: Array<{ name: string; connected: boolean }> = tenantId
      ? await this.dataSource.query(
          `SELECT t.name,
                  EXISTS (SELECT 1 FROM connections c
                           WHERE c.tenant_id = t.id AND c.type = 'instagram' AND c.status = 'connected') AS connected
             FROM tenants t WHERE t.id = $1`,
          [tenantId],
        )
      : [];
    if (!tenantId || !row) throw new GoneException({ message: 'This link has expired', details: { code: 'expired' } });
    if (row.connected) throw new GoneException({ message: 'Instagram is already connected', details: { code: 'connected' } });
    return { id: tenantId, name: row.name };
  }
}
