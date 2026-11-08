import { BadRequestException, Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import {
  CurrentUser,
  JwtPayload,
} from '../../common/decorators/current-user.decorator';
import { StoreConfig } from './entities/store-config.entity';
import { OnboardingReadiness } from '../onboarding/onboarding-readiness.service';
import { OnboardingService } from '../onboarding/onboarding.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { TelegramService } from '../notifications/telegram.service';

const OPERATING_MODES = ['learning', 'active', 'paused'] as const;

@ApiTags('engine')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
@Controller('engine')
export class StoreConfigController {
  constructor(
    @InjectRepository(StoreConfig)
    private readonly configRepo: Repository<StoreConfig>,
    private readonly readiness: OnboardingReadiness,
    private readonly telegram: TelegramService,
    private readonly onboarding: OnboardingService,
    private readonly subscriptions: SubscriptionsService,
  ) {}

  // ─── Store Config ──────────────────────────────────────────────

  @Get('config')
  async getConfig(@CurrentUser() user: JwtPayload) {
    let config = await this.configRepo.findOne({
      where: { tenantId: user.tenantId },
    });
    if (!config) {
      config = this.configRepo.create({ tenantId: user.tenantId });
      config = await this.configRepo.save(config);
    }
    return config;
  }

  @Patch('config')
  async updateConfig(
    @CurrentUser() user: JwtPayload,
    @Body() body: Partial<StoreConfig>,
  ) {
    let config = await this.configRepo.findOne({
      where: { tenantId: user.tenantId },
    });
    if (!config) {
      config = this.configRepo.create({ tenantId: user.tenantId });
    }
    // Shallow-merge jsonb configs instead of replacing them. Admin forms
    // model only a subset of each blob's keys (e.g. FlowConfigSection knows
    // preQualify but not businessType/sizeChart) — a replace would silently
    // destroy every key the form doesn't send. To clear a key, clients send
    // it explicitly with null; omitted keys always survive.
    const mergeJsonb = (
      current: Record<string, unknown> | null | undefined,
      patch: unknown,
    ) => {
      const merged = {
        ...(current ?? {}),
        ...(patch as Record<string, unknown>),
      };
      // An explicit null means "clear this key" — drop it rather than storing
      // `null`, so readers doing `'key' in flowConfig` and `?? default` agree.
      // Note this is the ONLY way a client can remove a key: `undefined` never
      // survives JSON serialisation, so a form that omits a field is
      // indistinguishable from one that never knew about it. That is the point
      // of the merge, and it is why clearing has to be explicit.
      for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
        if (v === null) delete merged[k];
      }
      return merged;
    };

    if (body.brandConfig !== undefined)
      config.brandConfig = mergeJsonb(config.brandConfig, body.brandConfig) as any;
    if (body.flowConfig !== undefined)
      config.flowConfig = mergeJsonb(config.flowConfig, body.flowConfig) as any;
    if (body.checkoutConfig !== undefined)
      config.checkoutConfig = mergeJsonb(config.checkoutConfig, body.checkoutConfig) as any;
    if (body.escalationConfig !== undefined)
      config.escalationConfig = mergeJsonb(config.escalationConfig, body.escalationConfig) as any;
    if (body.recommendationConfig !== undefined)
      config.recommendationConfig = mergeJsonb(config.recommendationConfig, body.recommendationConfig) as any;
    if (body.handoffConfig !== undefined)
      config.handoffConfig = mergeJsonb(config.handoffConfig, body.handoffConfig) as any;
    if (body.fallbackConfig !== undefined)
      config.fallbackConfig = mergeJsonb(config.fallbackConfig, body.fallbackConfig) as any;
    if (body.knowledgeDoc !== undefined) {
      config.knowledgeDoc = typeof body.knowledgeDoc === 'string' && body.knowledgeDoc.trim() ? body.knowledgeDoc : null;
    }
    // Turning the bot on is checked here, not only in the admin: a store with
    // no catalog or notes would answer real customers with nothing to say.
    const goingLive = body.operatingMode === 'active' && config.operatingMode !== 'active';
    if (body.operatingMode !== undefined) {
      if (!OPERATING_MODES.includes(body.operatingMode)) {
        throw new BadRequestException(`operatingMode must be one of ${OPERATING_MODES.join(', ')}`);
      }
      if (goingLive && user.role !== 'superadmin') {
        const readiness = await this.readiness.check(user.tenantId);
        if (!readiness.ready) {
          // `details` is what AllExceptionsFilter passes through to the client.
          throw new BadRequestException({
            message: 'The store is not ready to go live',
            details: { missing: readiness.missing },
          });
        }
      }
      config.operatingMode = body.operatingMode;
      if (body.operatingMode === 'learning' && !config.learningStartedAt) {
        config.learningStartedAt = new Date();
        config.learningNotifiedAt = null;
      } else if (body.operatingMode === 'active') {
        config.learningStartedAt = null;
        config.learningNotifiedAt = null;
      }
    }
    const saved = await this.configRepo.save(config);
    if (goingLive) {
      // The free trial runs from the moment the bot answers customers, not from sign-up.
      await this.subscriptions.startTrial(user.tenantId);
      void this.announceGoLive(user.tenantId);
    }
    // Turned on, or set to watch first: either way setup is over.
    if (body.operatingMode === 'active' || body.operatingMode === 'learning') {
      await this.onboarding.markCompleted(user.tenantId);
    }
    return saved;
  }

  private async announceGoLive(tenantId: string): Promise<void> {
    const [tenant]: Array<{ name: string; slug: string }> = await this.configRepo.manager
      .query(`SELECT name, slug FROM tenants WHERE id = $1`, [tenantId])
      .catch(() => []);
    await this.telegram.notifyPlatform(`🚀 AI-агента увімкнено: «${tenant?.name ?? tenantId}» (${tenant?.slug ?? '—'})`);
  }
}
