import { Injectable } from '@nestjs/common';
import { readFile } from 'fs/promises';
import { resolve } from 'path';
import { DataSource } from 'typeorm';
import { MessageDirection, MessageRole } from '@direct-mate/shared';
import { ConversationsService } from '../conversations/conversations.service';
import { TurnRunner, TurnRunResult, OutgoingMessage, TurnHandoff } from '../conversations/turn-runner.service';
import type { MessageAttachment } from '../conversations/entities/message.entity';
import { CustomerMediaService } from '../customer-media/customer-media.service';
import type { TraceSource } from '../conversations/entities/conversation-trace.entity';
import { OrderDraftService } from '../orders/order-draft.service';
import { AgentStoreSettingsService } from '../agent/store-settings.service';
import { draftForModel } from '../agent/tools/order.tools';
import type { AgentUsage, AttemptReport } from '../agent/agent.types';
import type { SimulatorScenario } from '../../scripts/scenarios/types';
import {
  AssertionResult,
  evaluateExpect,
  implicitChecks,
  mapLegacyExpect,
  TurnOutcome,
} from './scenario-assertions';
import { productsInToolOutputs, ShortlistItem, titlesMentioned } from './shortlist';
import type { ProductAttributes } from '../catalog/attributes/product-attributes';

/** Who the simulated customer is. Each caller uses its own, so runs never collide. */
export interface ScenarioIdentity {
  externalUserId: string;
  channel: string;
  channelAccountId: string;
}

export interface ScenarioTurnLog {
  turnIndex: number;
  conversationId: string;
  message: string;
  mediaReference?: { mediaId: string; type: string };
  advanceHours?: number;
  status: TurnRunResult['status'];
  messages: OutgoingMessage[];
  handoff: TurnHandoff | null;
  toolCalls: Array<{ attempt: number; toolName: string; input: unknown }>;
  attempts: AttemptReport[];
  draft: ReturnType<typeof draftForModel>;
  orderPlaced: boolean;
  paymentDetailsSent: boolean;
  /** Products the bot offered this turn, with their attributes. */
  shortlist: ShortlistItem[];
  assertions: AssertionResult[];
  /** Legacy assertion fields this turn had that check routes, not outcomes. */
  legacyDropped: string[];
  model: string | null;
  usage: AgentUsage | null;
  durationMs: number;
  traceId: string;
}

export class TenantNotFoundError extends Error {
  constructor(readonly tenantIdOrSlug: string) {
    super(`Scenario tenantId/slug "${tenantIdOrSlug}" not found in tenants table`);
    this.name = 'TenantNotFoundError';
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Runs a simulator scenario through the same turn runner real messages use,
 * in demo mode: orders are really placed and payment details really claimed,
 * so assertions read the database, not engine memory. Shared by the CLI
 * (`npm run simulate`) and the admin Simulator page.
 *
 * Each turn finds or creates the conversation like an inbound message does, so
 * conversation boundaries apply; `advanceHours` moves the clock to test them.
 * Applying a scenario's `flowConfigOverride` is left to the caller, which owns
 * the restore-on-crash policy.
 */
@Injectable()
export class ScenarioRunner {
  constructor(
    private readonly dataSource: DataSource,
    private readonly conversations: ConversationsService,
    private readonly turnRunner: TurnRunner,
    private readonly drafts: OrderDraftService,
    private readonly storeSettings: AgentStoreSettingsService,
    private readonly media: CustomerMediaService,
  ) {}

  async resolveTenantId(tenantIdOrSlug: string): Promise<string> {
    if (UUID_RE.test(tenantIdOrSlug)) return tenantIdOrSlug;
    const rows: Array<{ id: string }> = await this.dataSource.query(`SELECT id FROM tenants WHERE slug = $1 LIMIT 1`, [
      tenantIdOrSlug,
    ]);
    if (rows.length === 0) throw new TenantNotFoundError(tenantIdOrSlug);
    return rows[0].id;
  }

  /** `scenario.tenantId` must already be resolved to a UUID. */
  async run(
    scenario: SimulatorScenario,
    identity: ScenarioIdentity,
    opts: { source: TraceSource; modelOverride?: string; onTurn?: (log: ScenarioTurnLog) => void },
  ): Promise<ScenarioTurnLog[]> {
    const tenantId = scenario.tenantId;
    await this.cleanup(tenantId, identity);
    const logs: ScenarioTurnLog[] = [];
    let previousConversationId: string | null = null;

    for (const [index, turn] of scenario.turns.entries()) {
      if (turn.advanceHours) await this.advanceClock(tenantId, identity, turn.advanceHours);

      const customer = await this.conversations.findOrCreateCustomer(tenantId, identity.channel, identity.externalUserId);
      const { conversation } = await this.conversations.findOrCreateConversation(
        tenantId,
        customer.id,
        identity.channel,
        identity.channelAccountId,
      );

      const texts = Array.isArray(turn.message) ? turn.message : [turn.message];
      const save = (text: string, attachments: MessageAttachment[] | null) =>
        this.conversations.saveMessage(
          conversation.id,
          tenantId,
          MessageDirection.Inbound,
          MessageRole.User,
          text,
          undefined,
          null,
          attachments,
        );

      const photo = turn.image ? await this.storeImage(tenantId, turn.image) : null;
      if (photo) await save('', [photo]);
      let mediaReference = await this.resolveMedia(tenantId, turn);
      const attachment = mediaReference ? await this.media.attachmentFor(tenantId, mediaReference) : null;
      if (!mediaReference && photo?.url) mediaReference = { type: 'customer_photo', mediaId: photo.url };
      for (const [i, text] of texts.entries()) {
        const isLast = i === texts.length - 1;
        await save(text, isLast && attachment ? [attachment] : null);
      }

      const started = Date.now();
      const result = await this.turnRunner.run({
        tenantId,
        conversationId: conversation.id,
        mode: 'demo',
        source: opts.source,
        mediaReference,
        modelOverride: opts.modelOverride,
      });

      const outcome = {
        ...(await this.outcome(tenantId, conversation.id, customer.id, result)),
        newConversation: previousConversationId !== null && previousConversationId !== conversation.id,
      };
      previousConversationId = conversation.id;
      const { expect, dropped } = mapLegacyExpect(turn.expect ?? {});
      const log: ScenarioTurnLog = {
        turnIndex: index,
        conversationId: conversation.id,
        message: texts.join('\n'),
        ...(mediaReference && { mediaReference }),
        ...(turn.advanceHours && { advanceHours: turn.advanceHours }),
        status: result.status,
        messages: result.messages,
        handoff: result.handoff,
        toolCalls: (result.agent?.steps ?? []).flatMap((s) =>
          s.toolCalls.map((c) => ({ attempt: s.attempt, toolName: c.toolName, input: c.input })),
        ),
        attempts: result.agent?.attempts ?? [],
        draft: draftForModel(outcome.draft),
        orderPlaced: outcome.orderPlaced,
        paymentDetailsSent: outcome.paymentDetailsSent,
        shortlist: outcome.shortlist ?? [],
        assertions: [...evaluateExpect(expect, outcome), ...implicitChecks(outcome, expect)],
        legacyDropped: dropped,
        model: result.agent?.model ?? null,
        usage: result.agent?.usage ?? null,
        durationMs: Date.now() - started,
        traceId: result.traceId,
      };
      logs.push(log);
      opts.onTurn?.(log);
    }
    return logs;
  }

  /** Delete everything the simulated customer left behind in this tenant. */
  async cleanup(tenantId: string, identity: ScenarioIdentity): Promise<void> {
    const conversations = `SELECT conv.id FROM conversations conv
      JOIN customers cust ON conv.customer_id = cust.id
      WHERE cust.external_user_id = $1 AND cust.tenant_id = $2`;
    const params = [identity.externalUserId, tenantId];
    const photos: Array<{ url: string }> = await this.dataSource.query(
      `SELECT a->>'url' AS url FROM messages m
         CROSS JOIN LATERAL jsonb_array_elements(
           CASE WHEN jsonb_typeof(m.attachments) = 'array' THEN m.attachments ELSE '[]'::jsonb END) a
        WHERE m.conversation_id IN (${conversations}) AND a->>'url' IS NOT NULL`,
      params,
    );
    await this.media.remove(photos.map((p) => p.url));
    await this.dataSource.query(
      `DELETE FROM orders WHERE checkout_session_id IN (
         SELECT id FROM checkout_sessions WHERE conversation_id IN (${conversations}))`,
      params,
    );
    await this.dataSource.query(`DELETE FROM checkout_sessions WHERE conversation_id IN (${conversations})`, params);
    await this.dataSource.query(`DELETE FROM messages WHERE conversation_id IN (${conversations})`, params);
    await this.dataSource.query(`DELETE FROM conversation_state WHERE conversation_id IN (${conversations})`, params);
    await this.dataSource.query(
      `DELETE FROM conversations WHERE customer_id IN (
         SELECT id FROM customers WHERE external_user_id = $1 AND tenant_id = $2)`,
      params,
    );
    await this.dataSource.query(`DELETE FROM customers WHERE external_user_id = $1 AND tenant_id = $2`, params);
  }

  /** Shift the simulated customer's whole history back in time. */
  private async advanceClock(tenantId: string, identity: ScenarioIdentity, hours: number): Promise<void> {
    const conversations = `SELECT conv.id FROM conversations conv
      JOIN customers cust ON conv.customer_id = cust.id
      WHERE cust.external_user_id = $1 AND cust.tenant_id = $2`;
    const params = [identity.externalUserId, tenantId, hours];
    const back = `- make_interval(hours => $3)`;
    await this.dataSource.query(
      `UPDATE messages SET created_at = created_at ${back} WHERE conversation_id IN (${conversations})`,
      params,
    );
    await this.dataSource.query(
      `UPDATE conversations SET created_at = created_at ${back}, last_message_at = last_message_at ${back}
        WHERE id IN (${conversations})`,
      params,
    );
    await this.dataSource.query(
      `UPDATE orders SET created_at = created_at ${back} WHERE checkout_session_id IN (
         SELECT id FROM checkout_sessions WHERE conversation_id IN (${conversations}))`,
      params,
    );
    await this.dataSource.query(
      `UPDATE checkout_sessions SET created_at = created_at ${back}, updated_at = updated_at ${back}
        WHERE conversation_id IN (${conversations})`,
      params,
    );
  }

  /** A scenario photo: a file under test-assets/ or a URL, stored like an inbound Instagram photo. */
  private async storeImage(tenantId: string, image: string): Promise<MessageAttachment> {
    if (/^https?:\/\//i.test(image)) return this.media.storeFromUrl(tenantId, image);
    return this.media.storeFromBuffer(tenantId, await readFile(resolve(process.cwd(), 'test-assets', image)));
  }

  /**
   * `resolveMediaFromLinkedProduct` points a customer photo at the newest
   * product-linked media URL, so photo matching compares an image with itself.
   */
  private async resolveMedia(
    tenantId: string,
    turn: SimulatorScenario['turns'][number],
  ): Promise<{ mediaId: string; type: string } | undefined> {
    const ref = turn.mediaReference;
    if (!ref || !turn.resolveMediaFromLinkedProduct || ref.type !== 'customer_photo') return ref;
    const rows: Array<{ media_url: string }> = await this.dataSource.query(
      `SELECT media_url FROM instagram_media_mappings
        WHERE tenant_id = $1 AND product_id IS NOT NULL AND media_url IS NOT NULL
        ORDER BY created_at DESC LIMIT 1`,
      [tenantId],
    );
    return rows[0]?.media_url ? { ...ref, mediaId: rows[0].media_url } : ref;
  }

  private async outcome(
    tenantId: string,
    conversationId: string,
    customerId: string,
    result: TurnRunResult,
  ): Promise<Omit<TurnOutcome, 'newConversation'>> {
    const settings = await this.storeSettings.load(tenantId);
    const draft = await this.drafts.getCurrentDraft({ tenantId, conversationId, customerId }, settings.checkoutFields);
    const placed = await this.dataSource.query(
      `SELECT 1 FROM orders o JOIN checkout_sessions s ON s.id = o.checkout_session_id
        WHERE s.conversation_id = $1 LIMIT 1`,
      [conversationId],
    );
    const lastAttempt = result.agent?.attempts.at(-1);
    const replySent = result.messages.some((m) => m.kind === 'reply');
    return {
      status: result.status,
      messages: result.messages,
      handoff: result.handoff,
      toolCalls: (result.agent?.steps ?? []).flatMap((s) => s.toolCalls.map((c) => c.toolName)),
      draft,
      orderPlaced: placed.length > 0,
      paymentDetailsSent: !!draft?.paymentDetailsSentAt,
      finalStyle: replySent ? lastAttempt?.style ?? [] : [],
      shortlist: await this.shortlist(tenantId, result),
    };
  }

  /**
   * What the bot offered: products a tool returned this turn that the reply
   * names, plus products shown in photos.
   */
  private async shortlist(tenantId: string, result: TurnRunResult): Promise<ShortlistItem[]> {
    const agent = result.agent;
    if (!agent) return [];
    const reply = result.messages
      .filter((m) => m.kind === 'reply')
      .map((m) => m.text)
      .join('\n');
    const known = productsInToolOutputs(agent.steps.flatMap((s) => s.toolResults.map((r) => r.output)));
    const named = new Set(titlesMentioned(reply, [...known.values()]));
    const via = new Map<string, ShortlistItem['via']>();
    for (const [ref, title] of known) if (named.has(title)) via.set(ref, 'named');
    for (const effect of agent.effects) {
      if (effect.type !== 'show_products') continue;
      for (const image of effect.images) {
        const ref = image.productId.slice(0, 8);
        via.set(ref, via.get(ref)?.startsWith('named') ? 'named+photo' : 'photo');
      }
    }
    if (via.size === 0) return [];

    const rows: Array<{ id: string; title: string; category: string | null; attributes: ProductAttributes | null }> =
      await this.dataSource.query(
        `SELECT id, title, category, attributes FROM products
          WHERE tenant_id = $1 AND LEFT(id::text, 8) = ANY($2)`,
        [tenantId, [...via.keys()]],
      );
    return rows.map((r) => ({
      ref: r.id.slice(0, 8),
      title: r.title,
      category: r.category,
      attributes: r.attributes ?? {},
      via: via.get(r.id.slice(0, 8))!,
    }));
  }
}
