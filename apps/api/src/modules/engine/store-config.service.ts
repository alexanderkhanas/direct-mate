import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { StoreConfig } from './entities/store-config.entity';
import { OnboardingReadiness } from '../onboarding/onboarding-readiness.service';
import { OnboardingService } from '../onboarding/onboarding.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { TelegramService } from '../notifications/telegram.service';

export const OPERATING_MODES = ['learning', 'active', 'paused'] as const;
export type OperatingMode = (typeof OPERATING_MODES)[number];

/** What a mode change did, or why it didn't happen. */
export type ModeChange = { ok: true; wentLive: boolean } | { ok: false; missing: string[] };

/**
 * The store's operating mode: `paused`, `learning` (drafts next to the
 * manager's replies, nothing sent) or `active` (answers customers). One place
 * for the rules, used by the admin's config endpoint and by the Claude connector.
 */
@Injectable()
export class StoreConfigService {
  constructor(
    @InjectRepository(StoreConfig) private readonly configRepo: Repository<StoreConfig>,
    private readonly readiness: OnboardingReadiness,
    private readonly telegram: TelegramService,
    private readonly onboarding: OnboardingService,
    private readonly subscriptions: SubscriptionsService,
  ) {}

  /**
   * Put the new mode on a config that the caller then saves. Turning the bot
   * on is checked here, not only in the admin: a store with no catalog or
   * notes would answer real customers with nothing to say.
   */
  async applyMode(config: StoreConfig, mode: OperatingMode, opts: { skipGate?: boolean } = {}): Promise<ModeChange> {
    const wentLive = mode === 'active' && config.operatingMode !== 'active';
    if (wentLive && !opts.skipGate) {
      const readiness = await this.readiness.check(config.tenantId);
      if (!readiness.ready) return { ok: false, missing: readiness.missing };
    }
    config.operatingMode = mode;
    if (mode === 'learning' && !config.learningStartedAt) {
      config.learningStartedAt = new Date();
      config.learningNotifiedAt = null;
    } else if (mode === 'active') {
      config.learningStartedAt = null;
      config.learningNotifiedAt = null;
    }
    return { ok: true, wentLive };
  }

  /** After the config with its new mode is saved. */
  async afterModeSaved(tenantId: string, mode: OperatingMode, wentLive: boolean): Promise<void> {
    if (wentLive) {
      // The free trial runs from the moment the bot answers customers, not from sign-up.
      await this.subscriptions.startTrial(tenantId);
      void this.announceGoLive(tenantId);
    }
    // Turned on, or set to watch first: either way setup is over.
    if (mode === 'active' || mode === 'learning') await this.onboarding.markCompleted(tenantId);
  }

  /** Change only the mode. */
  async setOperatingMode(tenantId: string, mode: OperatingMode): Promise<ModeChange> {
    const config =
      (await this.configRepo.findOne({ where: { tenantId } })) ?? this.configRepo.create({ tenantId });
    const change = await this.applyMode(config, mode);
    if (!change.ok) return change;
    await this.configRepo.save(config);
    await this.afterModeSaved(tenantId, mode, change.wentLive);
    return change;
  }

  /** Who gives size advice. The rest of `flow_config.sizing` (e.g. `askMeasurementsFirst`) stays. */
  async setSizingAdvice(tenantId: string, advice: 'recommend' | 'consult'): Promise<void> {
    await this.configRepo.manager.query(
      `UPDATE store_configs
          SET flow_config = COALESCE(flow_config, '{}'::jsonb) || jsonb_build_object('sizing',
                COALESCE(flow_config->'sizing', '{}'::jsonb) || jsonb_build_object('advice', $2::text)),
              updated_at = now()
        WHERE tenant_id = $1`,
      [tenantId, advice],
    );
  }

  private async announceGoLive(tenantId: string): Promise<void> {
    const [tenant]: Array<{ name: string; slug: string }> = await this.configRepo.manager
      .query(`SELECT name, slug FROM tenants WHERE id = $1`, [tenantId])
      .catch(() => []);
    await this.telegram.notifyPlatform(`🚀 AI-агента увімкнено: «${tenant?.name ?? tenantId}» (${tenant?.slug ?? '—'})`);
  }
}
