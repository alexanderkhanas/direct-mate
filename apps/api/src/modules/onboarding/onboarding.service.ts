import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { TelegramService } from '../notifications/telegram.service';
import { OnboardingReadiness, type Readiness } from './onboarding-readiness.service';
import { DEFAULT_BRAND_TONE } from './store-defaults';

export type OnboardingStepKey = 'instagram' | 'products' | 'knowledge' | 'tone' | 'sizes' | 'telegram' | 'test' | 'live';

export interface OnboardingStep {
  key: OnboardingStepKey;
  state: 'todo' | 'done' | 'skipped';
  /** The bot can't be turned on without it. */
  blocking: boolean;
}

export interface OnboardingStatus {
  completed: boolean;
  operatingMode: string;
  steps: OnboardingStep[];
  readiness: Readiness;
  store: { name: string; businessType: string; instagram: string | null; feedUrl: string | null };
  /** «Налаштуйте за мене» is shown only when a support username is configured. */
  supportAvailable: boolean;
}

/** Steps the owner may skip; the blocking ones can't be. */
const SKIPPABLE: ReadonlySet<OnboardingStepKey> = new Set(['tone', 'sizes', 'telegram', 'test']);
const BLOCKING: ReadonlySet<OnboardingStepKey> = new Set(['instagram', 'products', 'knowledge']);
/** Registration's tone before Nov 2026; still the tone of stores that never changed it. */
const OLD_DEFAULT_TONE = 'Warm, friendly, concise.';

const STEP_LABEL_UK: Record<OnboardingStepKey, string> = {
  instagram: 'підключення Instagram',
  products: 'товари',
  knowledge: 'що знає бот (доставка, оплата)',
  tone: 'тон спілкування',
  sizes: 'розміри',
  telegram: 'сповіщення в Telegram',
  test: 'перевірка бота',
  live: 'увімкнення бота',
};

interface StoreRow {
  name: string;
  business_type: string;
  operating_mode: string | null;
  flow_business: string | null;
  knowledge: boolean;
  sizing_set: boolean;
  has_ranges: boolean;
  size_charts: boolean;
  telegram: boolean;
  brand_tone_prompt: string | null;
  steps_skipped: string[] | null;
  tested_at: Date | null;
  completed_at: Date | null;
  history_import: { applied?: boolean } | null;
  instagram: string | null;
  feed_url: string | null;
}

/**
 * The setup checklist. Each step's state is read from the store's real data
 * (a connection, products, notes, linked Telegram chats), so it can't drift
 * from what the bot actually has; `tenant_onboarding` only remembers skips,
 * drafts and timestamps.
 */
@Injectable()
export class OnboardingService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly readiness: OnboardingReadiness,
    private readonly telegram: TelegramService,
    private readonly config: ConfigService,
  ) {}

  async status(tenantId: string): Promise<OnboardingStatus> {
    await this.ensureRow(tenantId);
    const [row]: StoreRow[] = await this.dataSource.query(
      `SELECT t.name, t.business_type, sc.operating_mode,
              sc.flow_config->>'businessType' AS flow_business,
              length(btrim(coalesce(sc.knowledge_doc, ''))) > 0 AS knowledge,
              coalesce(sc.flow_config ? 'sizing', false) AS sizing_set,
              coalesce(jsonb_typeof(sc.flow_config->'sizeChart') = 'object', false) AS has_ranges,
              EXISTS (SELECT 1 FROM size_charts WHERE tenant_id = t.id) AS size_charts,
              (coalesce(jsonb_array_length(CASE WHEN jsonb_typeof(sc.handoff_config->'telegramChatIds') = 'array'
                                                THEN sc.handoff_config->'telegramChatIds' END), 0) > 0
               OR coalesce(sc.handoff_config->>'telegramChatId', '') <> '') AS telegram,
              ts.brand_tone_prompt,
              o.steps_skipped, o.tested_at, o.completed_at, o.history_import,
              (SELECT metadata->>'accountName' FROM connections
                WHERE tenant_id = t.id AND type = 'instagram' AND status = 'connected' LIMIT 1) AS instagram,
              (SELECT metadata->>'url' FROM connections WHERE tenant_id = t.id AND type = 'product_feed' LIMIT 1) AS feed_url
         FROM tenants t
         LEFT JOIN store_configs sc ON sc.tenant_id = t.id
         LEFT JOIN tenant_settings ts ON ts.tenant_id = t.id
         LEFT JOIN tenant_onboarding o ON o.tenant_id = t.id
        WHERE t.id = $1`,
      [tenantId],
    );
    const readiness = await this.readiness.check(tenantId);
    const clothing = row.business_type === 'fashion' || row.flow_business === 'clothing';
    const tone = row.brand_tone_prompt?.trim();
    const done: Record<OnboardingStepKey, boolean> = {
      instagram: !readiness.missing.includes('instagram'),
      products: !readiness.missing.includes('products'),
      knowledge: row.knowledge,
      tone: !!row.history_import?.applied || (!!tone && tone !== DEFAULT_BRAND_TONE && tone !== OLD_DEFAULT_TONE),
      sizes: row.sizing_set || row.has_ranges || row.size_charts,
      telegram: row.telegram,
      test: !!row.tested_at,
      live: row.operating_mode === 'active' || row.operating_mode === 'learning',
    };
    const keys: OnboardingStepKey[] = ['instagram', 'products', 'knowledge', 'tone', ...(clothing ? (['sizes'] as const) : []), 'telegram', 'test', 'live'];
    const skipped = new Set(row.steps_skipped ?? []);
    return {
      completed: !!row.completed_at,
      operatingMode: row.operating_mode ?? 'active',
      steps: keys.map((key) => ({
        key,
        state: done[key] ? 'done' : skipped.has(key) ? 'skipped' : 'todo',
        blocking: BLOCKING.has(key),
      })),
      readiness,
      store: { name: row.name, businessType: row.business_type, instagram: row.instagram, feedUrl: row.feed_url },
      supportAvailable: !!this.supportUsername(),
    };
  }

  async skip(tenantId: string, key: string): Promise<void> {
    if (!SKIPPABLE.has(key as OnboardingStepKey)) throw new BadRequestException(`Step "${key}" can't be skipped`);
    await this.ensureRow(tenantId);
    await this.dataSource.query(
      `UPDATE tenant_onboarding SET steps_skipped = array_append(array_remove(steps_skipped, $2), $2), updated_at = now()
        WHERE tenant_id = $1`,
      [tenantId, key],
    );
  }

  async markTested(tenantId: string): Promise<void> {
    await this.ensureRow(tenantId);
    await this.dataSource.query(
      `UPDATE tenant_onboarding SET tested_at = coalesce(tested_at, now()), updated_at = now() WHERE tenant_id = $1`,
      [tenantId],
    );
  }

  /** The bot was turned on (or set to watch): setup is over, the banner goes. */
  async markCompleted(tenantId: string): Promise<void> {
    await this.ensureRow(tenantId);
    await this.dataSource.query(
      `UPDATE tenant_onboarding SET completed_at = coalesce(completed_at, now()), updated_at = now() WHERE tenant_id = $1`,
      [tenantId],
    );
  }

  /**
   * «Налаштуйте за мене»: a t.me link to the founder with the message already
   * written (the owner still presses send), and a heads-up to the founder.
   */
  async requestHelp(tenantId: string, email: string, step: string | undefined): Promise<{ url: string | null }> {
    const status = await this.status(tenantId);
    await this.dataSource.query(
      `UPDATE tenant_onboarding SET help_requested_at = now(), updated_at = now() WHERE tenant_id = $1`,
      [tenantId],
    );
    const stepLabel = STEP_LABEL_UK[step as OnboardingStepKey];
    const lines = [
      'Привіт! Хочу налаштувати AI-агента DirectMate для свого Instagram-магазину.',
      `Магазин: ${status.store.name}`,
      `Email: ${email}`,
      status.store.instagram && `Instagram: @${status.store.instagram}`,
      status.store.feedUrl && `Товари: ${status.store.feedUrl}`,
      stepLabel && `Зупинився на кроці: ${stepLabel}`,
    ].filter(Boolean);
    void this.telegram.notifyPlatform(
      `🆘 Просять допомоги з налаштуванням: «${status.store.name}» (${email})${stepLabel ? `, крок: ${stepLabel}` : ''}`,
    );
    const username = this.supportUsername();
    return { url: username ? `https://t.me/${username}?text=${encodeURIComponent(lines.join('\n'))}` : null };
  }

  private supportUsername(): string | null {
    return this.config.get<string>('support.telegramUsername')?.replace(/^@/, '').trim() || null;
  }

  /** Stores created before this table (or by seed scripts) get a row; one already live counts as set up. */
  private async ensureRow(tenantId: string): Promise<void> {
    await this.dataSource.query(
      `INSERT INTO tenant_onboarding (tenant_id, completed_at)
       SELECT $1, CASE WHEN (SELECT operating_mode FROM store_configs WHERE tenant_id = $1) = 'active' THEN now() END
       ON CONFLICT (tenant_id) DO NOTHING`,
      [tenantId],
    );
  }
}
