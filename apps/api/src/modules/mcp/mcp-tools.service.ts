import { HttpException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { offeredFamilies } from '../agent/guards/grounding.guard';
import { FeedError } from '../catalog-feeds/feed-fetcher';
import { FeedSyncService } from '../catalog-feeds/feed-sync.service';
import { StoreConfigService } from '../engine/store-config.service';
import { TelegramService } from '../notifications/telegram.service';
import { NotesDrafterService } from '../onboarding/notes-drafter.service';
import { OnboardingService, type OnboardingStatus } from '../onboarding/onboarding.service';
import { KEY_SECTIONS, parseKnowledgeDoc, type NoteSection, type NotesPatch } from '../onboarding/store-notes';
import { TestChatService } from '../onboarding/test-chat.service';
import { SettingsService } from '../settings/settings.service';
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
  ) {}

  // ─── Status ──────────────────────────────────────────────────────

  async getSetupStatus(tenantId: string): Promise<ToolResult> {
    const [status, feed, plan] = await Promise.all([
      this.onboarding.status(tenantId),
      this.feeds.status(tenantId),
      this.plan(tenantId),
    ]);
    const pending = this.imports.get(tenantId);
    return {
      store: { name: status.store.name, instagram: status.store.instagram, operating_mode: status.operatingMode },
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
        'The link works once: if it has expired, call this tool again.',
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
          ? 'The AI agent recommends from a size table. Height and weight ranges or a size chart image are added in the admin panel, under Settings → Sizes; until then it hands size questions to a manager.'
          : 'Size questions go to a manager.',
      next: await this.next(tenantId),
    };
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
      return {
        error: { code: 'not_ready', message: 'The store is not ready to be turned on', details: { missing: change.missing } },
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

  // ─── Shared ──────────────────────────────────────────────────────

  private async next(tenantId: string, status?: OnboardingStatus): Promise<NextStep> {
    const current = status ?? (await this.onboarding.status(tenantId));
    const pending = this.imports.get(tenantId);
    const knowledgeTodo = current.steps.some((s) => s.key === 'knowledge' && s.state === 'todo');
    return nextStep(current, {
      importing: !!pending && !pending.problem,
      ...(knowledgeTodo && { missingSections: this.missingSections((await this.liveNotes(tenantId)).sections) }),
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
