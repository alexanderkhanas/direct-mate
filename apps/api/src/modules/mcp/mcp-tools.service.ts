import { HttpException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { offeredFamilies } from '../agent/guards/grounding.guard';
import { FeedError } from '../catalog-feeds/feed-fetcher';
import { FeedSyncService } from '../catalog-feeds/feed-sync.service';
import { StoreConfigService } from '../engine/store-config.service';
import { TelegramService } from '../notifications/telegram.service';
import { DirectPermissionsService, type DirectPermission } from '../onboarding/direct-permissions.service';
import { HistoryImportService } from '../onboarding/history/history-import.service';
import { NotesDrafterService } from '../onboarding/notes-drafter.service';
import { OnboardingService, type OnboardingStatus } from '../onboarding/onboarding.service';
import { KEY_SECTIONS, parseKnowledgeDoc, type NoteSection, type NotesPatch } from '../onboarding/store-notes';
import { TestChatService } from '../onboarding/test-chat.service';
import { SettingsService } from '../settings/settings.service';
import { toTable } from '../size-charts/size-chart-reader.service';
import type { MeasurementKey } from '../size-charts/size-chart-table';
import { SizeChartsService, type ScopeFilter } from '../size-charts/size-charts.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import type { ChatPreview } from './app/chat-preview';
import { HandoffService } from './handoff.service';
import { nextStep, type NextStep } from './setup-guide';
import { SetupEventsService } from './setup-events.service';

/** How long `connect_catalog` waits for the import before answering «still importing». */
export const IMPORT_WAIT_MS = 25_000;

export interface ToolProblem {
  code: string;
  message: string;
  details?: unknown;
}

/** Every tool answers with its data and what to do next; a problem comes back as data too, never as a bare exception. */
export type ToolResult = Record<string, unknown> & { next?: NextStep; error?: ToolProblem };

/** A size chart as Claude sends it (`save_size_chart`): units as printed, converted in code. */
export interface SizeChartInput {
  chartId?: string;
  brands?: string[];
  categories?: string[];
  measurements: Array<{ key: MeasurementKey; label?: string; unit: 'cm' | 'mm' | 'in' | 'kg' | 'lb' }>;
  rows: Array<{ size: string; cells: Array<{ key: MeasurementKey; min: number; max: number; uncertain?: boolean }> }>;
  confirmed?: boolean;
}

/** Names Claude gave, spelled as the store has them; the rest are unknown. */
function canonical(given: string[] | undefined, store: string[]): { known: string[]; unknown: string[] } {
  const byKey = new Map(store.map((name) => [name.trim().toLowerCase(), name]));
  const known = new Set<string>();
  const unknown: string[] = [];
  for (const name of given ?? []) {
    const match = byKey.get(name.trim().toLowerCase());
    if (match) known.add(match);
    else if (name.trim()) unknown.push(name);
  }
  return { known: [...known], unknown };
}

/** The same products: charts store their scope lower-cased. */
function sameScope(chart: { brands: string[]; categories: string[] }, filter: ScopeFilter): boolean {
  const key = (names: string[]) => [...new Set(names.map((n) => n.trim().toLowerCase()))].sort().join('\n');
  return key(chart.brands) === key(filter.brands) && key(chart.categories) === key(filter.categories);
}

/** The owner-facing name, as the admin builds it: «Lliana · Сукні, Сорочки», or «Усі товари». */
function chartName(filter: ScopeFilter): string {
  const name = [filter.brands.join(', '), filter.categories.join(', ')].filter(Boolean).join(' · ');
  if (!name) return 'Усі товари';
  return name.length > 80 ? `${name.slice(0, 79)}…` : name;
}

const PROMISE_WORDS: Record<string, string> = {
  discount: 'discounts',
  promo: 'promo codes',
  sale: 'sales',
  free: 'something free',
  gift: 'gifts',
  bonus: 'bonuses',
};

/**
 * What the Claude connector's tools do, one method per tool, each for the
 * tenant its caller's token belongs to. Kept apart from the MCP SDK so the
 * behaviour can be tested with plain objects.
 *
 * Text that we did not write (the agent's replies, product names from a feed,
 * the store's own notes) is returned under `untrusted_content`, apart from
 * `next`: Claude holds write tools, and that text must stay information.
 */
@Injectable()
export class McpToolsService {
  private readonly logger = new Logger(McpToolsService.name);
  /** Product imports started here and not finished, per tenant. In memory: production is a single replica. */
  private readonly imports = new Map<string, { startedAt: number; problem: ToolProblem | null }>();

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly config: ConfigService,
    private readonly onboarding: OnboardingService,
    private readonly notes: NotesDrafterService,
    private readonly testChat: TestChatService,
    private readonly feeds: FeedSyncService,
    private readonly telegram: TelegramService,
    private readonly settings: SettingsService,
    private readonly storeConfig: StoreConfigService,
    private readonly subscriptions: SubscriptionsService,
    private readonly handoffs: HandoffService,
    private readonly events: SetupEventsService,
    private readonly permissions: DirectPermissionsService,
    private readonly history: HistoryImportService,
    private readonly sizeCharts: SizeChartsService,
  ) {}

  // ─── Status ──────────────────────────────────────────────────────

  async getSetupStatus(tenantId: string): Promise<ToolResult> {
    const [status, feed, plan, permissions, history] = await Promise.all([
      this.onboarding.status(tenantId),
      this.feeds.status(tenantId),
      this.plan(tenantId),
      this.permissions.get(tenantId),
      this.history.get(tenantId),
    ]);
    const pending = this.imports.get(tenantId);
    return {
      store: { name: status.store.name, instagram: status.store.instagram, operating_mode: status.operatingMode },
      instagram_permissions: {
        read_messages: permissions.read_messages.allowed,
        reply_to_customers: permissions.reply_to_customers.allowed,
      },
      history_import: permissions.read_messages.allowed ? (history.import?.status ?? 'idle') : 'not_allowed',
      steps: status.steps,
      missing_to_turn_on: status.readiness.missing,
      catalog: {
        products: status.store.products,
        feed_url: feed.feed?.url ?? null,
        importing: !!pending && !pending.problem,
        last_error: pending?.problem ?? feed.feed?.lastError ?? null,
      },
      plan,
      next: await this.next(tenantId, status),
    };
  }

  // ─── Catalog ─────────────────────────────────────────────────────

  async previewCatalogFeed(tenantId: string, url: string): Promise<ToolResult> {
    try {
      const preview = await this.feeds.preview(tenantId, url);
      return {
        format: preview.format,
        products: preview.products,
        variants: preview.variants,
        in_stock: preview.inStock,
        warnings: preview.warnings,
        untrusted_content: { sample: preview.sample.map(({ image: _image, ...rest }) => rest) },
        next: {
          step: 'products',
          why: 'This is what the link holds; nothing is imported yet.',
          ask_owner: ['Does this look like your catalog? Shall I import it?'],
          then_call: 'connect_catalog with source "feed" and the same url.',
        },
      };
    } catch (err) {
      return this.failed(tenantId, err);
    }
  }

  async connectCatalog(tenantId: string, input: { source: 'feed' | 'shopify'; url?: string }): Promise<ToolResult> {
    if (input.source === 'shopify') {
      const link = await this.handoffs.issue(tenantId, 'shopify');
      return {
        link: link.url,
        link_expires_in_seconds: link.expiresInSeconds,
        note:
          'Give the owner this link: they enter the Shopify shop address and access token there, never in this chat. ' +
          'After they connect, products are synced by the DirectMate team, which can take a while: a product feed link imports at once.',
        next: await this.next(tenantId),
      };
    }
    const url = (input.url ?? '').trim();
    if (!url) return { error: { code: 'url_required', message: 'A feed needs its link' }, next: await this.next(tenantId) };

    const pending = { startedAt: Date.now(), problem: null as ToolProblem | null };
    this.imports.set(tenantId, pending);
    // The import outlives this call when it is slow, so it settles itself here:
    // an unhandled rejection would take the process down.
    const work = this.feeds.connect(tenantId, url).then(
      async (status) => {
        this.imports.delete(tenantId);
        await this.events.record(tenantId, 'catalog_connected');
        return { status };
      },
      (err) => {
        pending.problem = this.problem(err) ?? { code: 'import_failed', message: 'The import failed' };
        this.logger.warn(`Feed import from Claude failed for ${tenantId}: ${(err as Error).message}`);
        return { problem: pending.problem };
      },
    );
    const done = await Promise.race([work, new Promise<null>((r) => setTimeout(() => r(null), IMPORT_WAIT_MS))]);

    if (!done) {
      return {
        importing: true,
        note: 'The import is still running. It carries on by itself: check get_setup_status in a minute.',
        next: await this.next(tenantId),
      };
    }
    if ('problem' in done) {
      this.imports.delete(tenantId);
      return { error: done.problem, next: await this.next(tenantId) };
    }
    return {
      importing: false,
      products: done.status.feed?.products ?? null,
      warnings: done.status.feed?.warnings ?? [],
      next: await this.next(tenantId),
    };
  }

  // ─── Connections that need a browser ─────────────────────────────

  async connectInstagram(tenantId: string): Promise<ToolResult> {
    const link = await this.handoffs.issue(tenantId, 'instagram');
    return {
      link: link.url,
      link_expires_in_seconds: link.expiresInSeconds,
      note:
        'Give the owner this link. It opens the Instagram login in their browser; they come back here when it says so. ' +
        'The link works once: if it has expired, call this tool again. Tell the owner now: connecting does not let DirectMate read ' +
        'their Direct (you will ask for that permission next), and the AI agent sends nothing to anyone until they turn it on at the end of the setup.',
      next: {
        step: 'instagram',
        why: 'Waiting for the owner to connect Instagram in the browser.',
        ask_owner: ['Tell me when you are back.'],
        then_call: 'get_setup_status once the owner is back.',
      },
    };
  }

  async connectTelegram(tenantId: string): Promise<ToolResult> {
    const link = await this.telegram.generateConnectToken(tenantId);
    return {
      link: link.deepLink,
      link_expires_in_seconds: 600,
      note: 'Give the owner this link: it opens the DirectMate Telegram bot, where they press Start. Handoff notices then come to that chat.',
      next: {
        step: 'telegram',
        why: 'Waiting for the owner to press Start in Telegram.',
        ask_owner: ['Tell me when you have pressed Start.'],
        then_call: 'get_setup_status once the owner is back.',
      },
    };
  }

  // ─── Store notes ─────────────────────────────────────────────────

  async getStoreNotes(tenantId: string): Promise<ToolResult> {
    const live = await this.liveNotes(tenantId);
    return {
      missing_sections: this.missingSections(live.sections),
      untrusted_content: {
        sections: live.sections,
        payment_details: live.paymentDetails,
        checkout_fields: live.checkoutFields,
      },
      next: await this.next(tenantId),
    };
  }

  async saveStoreNotes(tenantId: string, patch: NotesPatch): Promise<ToolResult> {
    const draft = await this.notes.mergeAndApply(tenantId, patch);
    const text = Object.values(draft.sections).join('\n');
    const warnings = [...offeredFamilies(text)].map(
      (family) =>
        `The notes mention ${PROMISE_WORDS[family] ?? family}: this lets the AI-агент promise them to customers. Keep it only if the store really offers that, with its exact terms.`,
    );
    return {
      saved_sections: Object.keys(patch.sections ?? {}),
      missing_sections: this.missingSections(draft.sections),
      warnings,
      next: await this.next(tenantId),
    };
  }

  // ─── Tone, sizes, skipping ───────────────────────────────────────

  async setTone(tenantId: string, tone: string): Promise<ToolResult> {
    await this.settings.updateSettings(tenantId, { brandTone: tone.trim().slice(0, 2000) });
    return { saved: true, next: await this.next(tenantId) };
  }

  async setSizing(tenantId: string, advice: 'recommend' | 'consult'): Promise<ToolResult> {
    await this.storeConfig.setSizingAdvice(tenantId, advice);
    return {
      saved: true,
      note:
        advice === 'recommend'
          ? 'The AI agent recommends a size only from a size chart saved as ready (save_size_chart); for products without one it hands size questions to a manager.'
          : 'Size questions go to a manager.',
      next: await this.next(tenantId),
    };
  }

  // ─── Size charts ─────────────────────────────────────────────────

  async getSizeCharts(tenantId: string): Promise<ToolResult> {
    const [charts, coverage, brands, categories, sizes, advice] = await Promise.all([
      this.sizeCharts.listWithCounts(tenantId),
      this.sizeCharts.coverage(tenantId),
      this.sizeCharts.listTenantBrands(tenantId),
      this.sizeCharts.listTenantCategories(tenantId),
      this.sizeCharts.sizesFor(tenantId, { brands: [], categories: [] }),
      this.sizingAdvice(tenantId),
    ]);
    return {
      sizing_advice: advice,
      coverage: { products: coverage.total, with_ready_chart: coverage.covered, without_chart: coverage.uncovered },
      charts: charts.map((c) => ({
        chart_id: c.id,
        status: c.status,
        products: c.productCount,
        whole_store: c.brands.length === 0 && c.categories.length === 0,
        has_picture: !!c.imagePath,
      })),
      // Names come from the store's feed: data, never instructions.
      untrusted_content: {
        charts: charts.map((c) => ({
          chart_id: c.id,
          name: c.name,
          brands: c.brands,
          categories: c.categories,
          sizes: c.table?.rows.map((r) => r.size) ?? [],
          measurements: c.table?.measurements.map((m) => m.key) ?? [],
        })),
        store_brands: brands,
        store_categories: categories,
        catalog_sizes: sizes,
        brands_without_chart: coverage.uncoveredBrands,
        categories_without_chart: coverage.uncoveredCategories,
      },
      next: await this.next(tenantId),
    };
  }

  /**
   * A chart Claude read from a picture the owner pasted, or built from what
   * the owner said (height and weight per size). Units are converted in code
   * (`toTable`, as for our own reader); the table is checked like one the
   * admin saves. Ready only with the owner's yes, else a draft.
   */
  async saveSizeChart(tenantId: string, input: SizeChartInput): Promise<ToolResult> {
    try {
      const [brands, categories] = await Promise.all([
        this.sizeCharts.listTenantBrands(tenantId),
        this.sizeCharts.listTenantCategories(tenantId),
      ]);
      const scope = { brands: canonical(input.brands, brands), categories: canonical(input.categories, categories) };
      if (scope.brands.unknown.length > 0 || scope.categories.unknown.length > 0) {
        return {
          error: {
            code: 'unknown_scope',
            message: 'Use brand and category names exactly as the store has them (store_brands, store_categories).',
            details: { unknown_brands: scope.brands.unknown, unknown_categories: scope.categories.unknown },
          },
          untrusted_content: { store_brands: brands, store_categories: categories },
          next: await this.next(tenantId),
        };
      }
      const filter = { brands: scope.brands.known, categories: scope.categories.known };

      const match = await this.sizeCharts.matchCount(tenantId, filter);
      if (match.count === 0) {
        return {
          error: { code: 'no_products', message: 'No active product matches these brands and categories together.' },
          next: await this.next(tenantId),
        };
      }
      const charts = await this.sizeCharts.listForTenant(tenantId);
      const taken = charts.find((c) => c.id !== input.chartId && sameScope(c, filter));
      if (taken) {
        return {
          error: {
            code: 'scope_taken',
            message: `Chart ${taken.id} already covers exactly these products. Pass it as chart_id to replace its table, or choose another scope.`,
            details: { chart_id: taken.id },
          },
          next: await this.next(tenantId),
        };
      }

      const table = toTable({
        isSizeChart: true,
        measurements: input.measurements.map((m) => ({ key: m.key, label: m.label ?? '', unit: m.unit })),
        rows: input.rows.map((r) => ({
          size: r.size,
          cells: r.cells.map((c) => ({ key: c.key, min: c.min, max: c.max, uncertain: c.uncertain === true })),
        })),
      });
      if (!table) {
        return {
          error: { code: 'empty_table', message: 'No size has a value for a listed measurement.' },
          next: await this.next(tenantId),
        };
      }

      const status = input.confirmed === true ? 'ready' : 'draft';
      const name = chartName(filter);
      const chart = input.chartId
        ? await this.sizeCharts.update(tenantId, input.chartId, { name, ...filter, isDefault: false, table, status })
        : await this.sizeCharts.createFromTable(tenantId, { name, ...filter, table, status });

      // A store that chose «a manager advises» recommends again once it has a checked chart, as in the admin setup.
      if (status === 'ready' && (await this.sizingAdvice(tenantId)) === 'consult') {
        await this.storeConfig.setSizingAdvice(tenantId, 'recommend');
      }

      const inChart = new Set(table.rows.map((r) => r.size.trim().toUpperCase()));
      const [sold, coverage] = await Promise.all([
        this.sizeCharts.sizesFor(tenantId, filter),
        this.sizeCharts.coverage(tenantId),
      ]);
      return {
        saved: { chart_id: chart.id, status, products: match.count, sizes: table.rows.map((r) => r.size) },
        warnings: [
          ...(table.uncertain.length > 0 && status === 'draft'
            ? [`Cells marked uncertain: ${table.uncertain.map((u) => `${u.size} ${u.key}`).join(', ')}. Ask the owner about them.`]
            : []),
        ],
        coverage: { products: coverage.total, with_ready_chart: coverage.covered, without_chart: coverage.uncovered },
        untrusted_content: {
          sizes_sold_but_not_in_chart: sold.filter((s) => !inChart.has(s.trim().toUpperCase())),
          categories_without_chart: coverage.uncoveredCategories,
        },
        note:
          status === 'ready'
            ? 'Saved as ready: the AI agent now recommends sizes from this chart for these products. It has no picture, so the agent sends no chart image to customers.'
            : 'Saved as a draft: the AI agent does not use it yet. After the owner confirms the table, call again with chart_id and confirmed: true, or they can check it in the admin under Size charts.',
        next: await this.next(tenantId),
      };
    } catch (err) {
      return this.failed(tenantId, err);
    }
  }

  async deleteSizeChart(tenantId: string, input: { chartId: string; confirmed?: boolean }): Promise<ToolResult> {
    if (input.confirmed !== true) {
      return {
        error: { code: 'not_confirmed', message: 'Ask the owner whether to delete this chart, and call again with confirmed: true only after they say yes.' },
        next: await this.next(tenantId),
      };
    }
    try {
      await this.sizeCharts.delete(tenantId, input.chartId);
      const coverage = await this.sizeCharts.coverage(tenantId);
      return {
        deleted: input.chartId,
        coverage: { products: coverage.total, with_ready_chart: coverage.covered, without_chart: coverage.uncovered },
        next: await this.next(tenantId),
      };
    } catch (err) {
      return this.failed(tenantId, err);
    }
  }

  private async sizingAdvice(tenantId: string): Promise<'recommend' | 'consult'> {
    const [row]: Array<{ advice: string | null }> = await this.dataSource.query(
      `SELECT flow_config->'sizing'->>'advice' AS advice FROM store_configs WHERE tenant_id = $1`,
      [tenantId],
    );
    return row?.advice === 'consult' ? 'consult' : 'recommend';
  }

  async skipSetupStep(tenantId: string, step: string): Promise<ToolResult> {
    try {
      await this.onboarding.skip(tenantId, step);
      return { skipped: step, next: await this.next(tenantId) };
    } catch (err) {
      return this.failed(tenantId, err);
    }
  }

  // ─── Trying the agent, turning it on ─────────────────────────────

  async tryAgent(tenantId: string, input: { message: string; newConversation?: boolean }): Promise<ToolResult> {
    try {
      if (input.newConversation) await this.testChat.reset(tenantId);
      const result = await this.testChat.send(tenantId, { text: input.message });
      await this.events.record(tenantId, 'first_try_agent');
      const replies = result.messages.map((m) => ({
        text: m.text,
        images: (m.imageUrls ?? []).map((u) => this.absolute(u)),
      }));
      return {
        status: result.status,
        ...(result.skipReason && { skip_reason: result.skipReason }),
        handed_to_manager: result.handoff,
        ...(replies.length === 0 && {
          note:
            result.status === 'busy'
              ? 'The AI agent was still answering the previous message. Send it again in a few seconds.'
              : 'The AI agent did not answer this message.',
        }),
        untrusted_content: { customer_message: input.message, replies },
        next: await this.next(tenantId),
      };
    } catch (err) {
      return this.failed(tenantId, err);
    }
  }

  /** The whole test conversation, for the chat preview Claude shows next to `try_agent`. */
  async chatPreview(tenantId: string, handedToManager: boolean): Promise<ChatPreview> {
    const [history, [tenant]] = await Promise.all([
      this.testChat.history(tenantId),
      this.dataSource.query(`SELECT name FROM tenants WHERE id = $1`, [tenantId]) as Promise<Array<{ name: string }>>,
    ]);
    return {
      store: tenant?.name ?? '',
      messages: history.slice(-40).map((m) => ({
        role: m.role,
        text: m.text,
        images: (m.imageUrls ?? []).map((u) => this.absolute(u)),
      })),
      handedToManager,
    };
  }

  /**
   * The hosts the preview may load pictures from: ours (uploads) and those of
   * this store's product photos, which a feed leaves on the shop's own CDN.
   */
  async previewImageOrigins(tenantId: string): Promise<string[]> {
    const rows: Array<{ origin: string }> = await this.dataSource.query(
      `SELECT DISTINCT substring(pm.url from '^https?://[^/?#]+') AS origin
         FROM product_media pm JOIN products p ON p.id = pm.product_id
        WHERE p.tenant_id = $1 AND pm.url ~ '^https?://' LIMIT 20`,
      [tenantId],
    );
    const own = new URL(this.config.get<string>('app.baseUrl') ?? 'http://localhost:3000').origin;
    return [...new Set([own, ...rows.map((r) => r.origin).filter(Boolean)])];
  }

  private absolute(url: string): string {
    const base = this.config.get<string>('app.baseUrl') ?? 'http://localhost:3000';
    return url.startsWith('/') ? `${base}${url}` : url;
  }

  async goLive(tenantId: string, input: { mode: 'learning' | 'active'; confirmed: boolean }): Promise<ToolResult> {
    const status = await this.onboarding.status(tenantId);
    if (input.confirmed !== true) {
      return {
        error: {
          code: 'not_confirmed',
          message: `Ask the owner whether to switch to ${input.mode} mode, and call again with confirmed: true only after they say yes.`,
        },
        next: await this.next(tenantId, status),
      };
    }
    // Learning mode watches real conversations: without Instagram there is nothing to watch.
    if (input.mode === 'learning' && !status.steps.some((s) => s.key === 'instagram' && s.state === 'done')) {
      return {
        error: { code: 'not_ready', message: 'Instagram is not connected yet', details: { missing: ['instagram'] } },
        next: await this.next(tenantId, status),
      };
    }
    const change = await this.storeConfig.setOperatingMode(tenantId, input.mode);
    if (!change.ok) {
      const permission = change.missing.includes('reply_permission')
        ? 'reply_to_customers'
        : change.missing.includes('read_permission')
          ? 'read_messages'
          : null;
      return {
        error: {
          code: permission ? 'permission_needed' : 'not_ready',
          message: permission
            ? `${input.mode === 'active' ? 'Active mode' : 'Learning mode'} needs the owner's "${permission}" permission. Ask them (set_instagram_permission), then call go_live again.`
            : 'The store is not ready to be turned on',
          details: { missing: change.missing },
        },
        next: await this.next(tenantId, status),
      };
    }
    await this.events.record(tenantId, 'go_live');
    return {
      operating_mode: input.mode,
      note:
        input.mode === 'active'
          ? 'The AI agent now answers customers in Instagram DMs.'
          : 'Learning mode: the AI agent drafts its replies next to the managers’ and sends nothing. The free trial has not started; it starts when the agent is turned on fully.',
      plan: await this.plan(tenantId),
      next: await this.next(tenantId),
    };
  }

  // ─── The owner's permissions for the Direct, and the history import ───

  async setInstagramPermission(
    tenantId: string,
    input: { permission: DirectPermission; allowed: boolean; confirmed?: boolean },
    userId?: string | null,
  ): Promise<ToolResult> {
    if (input.allowed && input.confirmed !== true) {
      return {
        error: {
          code: 'not_confirmed',
          message: `Ask the owner about "${input.permission}" on its own, and call again with confirmed: true only after they clearly say yes.`,
        },
        next: await this.next(tenantId),
      };
    }
    const result = await this.permissions.set(tenantId, input.permission, input.allowed, { source: 'claude', userId });
    const readNow = input.permission === 'read_messages' && input.allowed;
    return {
      instagram_permissions: {
        read_messages: result.permissions.read_messages.allowed,
        reply_to_customers: result.permissions.reply_to_customers.allowed,
      },
      ...(result.operatingMode && { operating_mode: result.operatingMode }),
      note: readNow
        ? 'Reading the recent chats starts within a minute and can take up to an hour (one queue for every store, paced by Instagram). Carry on with the setup; get_history_import shows what was learned.'
        : result.operatingMode
          ? 'The store was using this permission, so the AI agent is now paused.'
          : input.allowed
            ? 'Saved.'
            : 'Saved: not allowed. The owner can allow it later.',
      next: await this.next(tenantId),
    };
  }

  /**
   * What the history import learned: the shop's terms and its tone, for Claude
   * to confirm with the owner and save through save_store_notes and set_tone.
   * The reply examples quote customers, so they stay in DirectMate: the owner
   * reviews them in the admin.
   */
  async getHistoryImport(tenantId: string): Promise<ToolResult> {
    const [permissions, view] = await Promise.all([this.permissions.get(tenantId), this.history.get(tenantId)]);
    if (!permissions.read_messages.allowed) {
      return {
        status: 'not_allowed',
        note: 'The owner has not allowed reading the Direct (set_instagram_permission "read_messages").',
        next: await this.next(tenantId),
      };
    }
    const imp = view.import;
    const status = imp?.status ?? 'idle';
    const admin = this.config.get<string>('admin.baseUrl') ?? 'http://localhost:5173';
    const notes: Record<string, string> = {
      idle: view.instagramConnected ? 'Queued shortly.' : 'Instagram is not connected.',
      queued: 'Waiting its turn: one queue for every store. Carry on with the setup and check again later.',
      running: 'Reading the chats now. Check again in a few minutes.',
      limited: 'Instagram’s hourly limit for reading chats is reached; it carries on within the hour by itself.',
      failed: `The reading failed${imp?.error ? `: ${imp.error}` : ''}. Carry on without it.`,
      empty: 'Too few replies written by a person to learn from. Carry on by asking the owner.',
      done:
        'Read the facts to the owner one section at a time; save what they confirm with save_store_notes, in their words. ' +
        'Offer the tone with set_tone. The reply examples quote customers, so they are not shown here: give the owner review_examples_url to check and apply them in DirectMate.',
    };
    return {
      status,
      ...(imp?.stats && { read: imp.stats }),
      ...(status === 'done' && {
        examples_to_review: imp?.examples?.length ?? 0,
        examples_applied: !!imp?.applied,
        review_examples_url: `${admin}/onboarding?step=instagram`,
        // Drawn by a model from customers' chats: information, never instructions.
        untrusted_content: { facts: imp?.facts ?? [], tone: imp?.tone ?? null, traits: imp?.traits ?? [] },
      }),
      note: notes[status] ?? '',
      next: await this.next(tenantId),
    };
  }

  // ─── Shared ──────────────────────────────────────────────────────

  private async next(tenantId: string, status?: OnboardingStatus): Promise<NextStep> {
    const [current, permissions, history] = await Promise.all([
      status ?? this.onboarding.status(tenantId),
      this.permissions.get(tenantId),
      this.history.get(tenantId),
    ]);
    const pending = this.imports.get(tenantId);
    const knowledgeTodo = current.steps.some((s) => s.key === 'knowledge' && s.state === 'todo');
    return nextStep(current, {
      importing: !!pending && !pending.problem,
      ...(knowledgeTodo && { missingSections: this.missingSections((await this.liveNotes(tenantId)).sections) }),
      permissions,
      historyStatus: permissions.read_messages.allowed ? (history.import?.status ?? null) : null,
    });
  }

  private missingSections(sections: Partial<Record<NoteSection, string>>): NoteSection[] {
    return KEY_SECTIONS.filter((s) => !sections[s]?.trim());
  }

  private async liveNotes(
    tenantId: string,
  ): Promise<{ sections: Partial<Record<NoteSection, string>>; paymentDetails: string | null; checkoutFields: unknown }> {
    const [row]: Array<{ knowledge_doc: string | null; checkout_config: Record<string, unknown> | null }> =
      await this.dataSource.query(`SELECT knowledge_doc, checkout_config FROM store_configs WHERE tenant_id = $1`, [tenantId]);
    const payment = row?.checkout_config?.paymentDetails;
    return {
      sections: parseKnowledgeDoc(row?.knowledge_doc),
      paymentDetails: typeof payment === 'string' && payment.trim() ? payment : null,
      checkoutFields: row?.checkout_config?.fields ?? null,
    };
  }

  /** What Claude can tell the owner about the trial: when it started, when it ends, whether the agent may answer. */
  private async plan(tenantId: string): Promise<Record<string, unknown>> {
    const p = await this.subscriptions.getPlanForTenant(tenantId);
    return {
      type: p.plan?.planType ?? null,
      // False on an ended trial or unpaid plan: the agent stays silent even when turned on.
      agent_may_answer: p.active,
      trial_started: p.trialStarted,
      trial_days_remaining: p.trialDaysRemaining,
      trial_ends_at: p.plan?.trialEndsAt ?? null,
      conversations: { used: p.usage.used, limit: p.usage.limit },
    };
  }

  private async failed(tenantId: string, err: unknown): Promise<ToolResult> {
    const problem = this.problem(err);
    if (!problem) throw err;
    return { error: problem, next: await this.next(tenantId) };
  }

  /** Problems the owner can act on, as data. Anything else is a bug and is thrown. */
  private problem(err: unknown): ToolProblem | null {
    if (err instanceof FeedError) return { code: err.code, message: err.message };
    if (err instanceof HttpException) {
      const body = err.getResponse();
      const details = typeof body === 'object' && body !== null ? (body as Record<string, unknown>).details : undefined;
      const status = err.getStatus();
      if (status >= 500) return null;
      return {
        code: status === 429 ? 'rate_limited' : 'invalid_request',
        message: err.message,
        ...(details !== undefined && { details }),
      };
    }
    return null;
  }
}
