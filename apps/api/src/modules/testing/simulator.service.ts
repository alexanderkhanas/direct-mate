import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { MessageDirection, MessageRole } from '@direct-mate/shared';
import { ConversationsService } from '../conversations/conversations.service';
import { OutgoingMessage, TurnRunner } from '../conversations/turn-runner.service';
import type { MessageAttachment } from '../conversations/entities/message.entity';
import { CustomerMediaService } from '../customer-media/customer-media.service';
import { OrderDraftService } from '../orders/order-draft.service';
import { AgentStoreSettingsService } from '../agent/store-settings.service';
import { draftForModel } from '../agent/tools/order.tools';
import { deepMerge } from '../../common/deep-merge';
import { SimulatorScenario } from '../../scripts/scenarios';
import { ScenarioIdentity, ScenarioRunner, ScenarioTurnLog } from './scenario-runner.service';

// Separate identities from the CLI simulator, so the two never collide.
const SCENARIO_IDENTITY: ScenarioIdentity = {
  externalUserId: 'sim-api-001',
  channel: 'instagram',
  channelAccountId: 'sim-api-channel',
};
// The live DM console's chat persists across messages and is NOT wiped when
// scenarios run.
const LIVE_IDENTITY: ScenarioIdentity = {
  externalUserId: 'sim-live-001',
  channel: 'instagram',
  channelAccountId: 'sim-live-channel',
};

// The response shapes below predate the agent; the admin Simulator page reads
// them. Agent turns fill them as follows: `classification` is null, `scenario`
// lists the tools called, `state` carries the order draft, and `trace` has one
// line per tool call and retry.

export interface LiveTurnResult {
  conversationId: string;
  message: string;
  mediaReference?: { mediaId: string; type: string };
  /** Our copy of the photo sent with the message. */
  photoUrl?: string;
  /** Why the photo couldn't be stored. */
  photoError?: MessageAttachment['error'];
  classification: Record<string, unknown> | null;
  decision: string;
  scenario: string | null;
  replyText: string | null;
  extraReplies: Array<{ text: string; imageUrls?: string[] }>;
  imageUrls?: string[];
  state: Record<string, unknown>;
  trace: string[];
}

export interface SimulatorTurnLog {
  turnIndex: number;
  message: string;
  mediaReference?: { mediaId: string; type: string };
  classification: Record<string, unknown> | null;
  decision: string;
  scenario: string | null;
  replyText: string | null;
  /** Further messages sent after `replyText` (welcome line first, then the reply, etc.). */
  extraReplies?: Array<{ text: string; imageUrls?: string[] }>;
  imageUrls?: string[];
  state: Record<string, unknown>;
  assertions: Array<{ field: string; pass: boolean; expected: unknown; actual: unknown; message?: string }>;
  trace: string[];
}

/**
 * The admin Simulator page: scenario runs through the shared ScenarioRunner,
 * and an interactive "live DM" console. Both use the real turn runner in
 * demo mode, and never call the Meta send API.
 */
@Injectable()
export class SimulatorService {
  constructor(
    private readonly conversationsService: ConversationsService,
    private readonly dataSource: DataSource,
    private readonly scenarioRunner: ScenarioRunner,
    private readonly turnRunner: TurnRunner,
    private readonly drafts: OrderDraftService,
    private readonly storeSettings: AgentStoreSettingsService,
    private readonly media: CustomerMediaService,
  ) {}

  async runScenario(scenario: SimulatorScenario): Promise<SimulatorTurnLog[]> {
    const resolved = { ...scenario, tenantId: await this.scenarioRunner.resolveTenantId(scenario.tenantId) };
    const restore = await this.applyFlowConfigOverride(resolved);
    try {
      const logs = await this.scenarioRunner.run(resolved, SCENARIO_IDENTITY, { source: 'simulator_scenario' });
      return logs.map(toTurnLog);
    } finally {
      await restore();
    }
  }

  /** Send one ad-hoc message to the persistent live conversation. */
  async sendLiveMessage(
    tenantId: string,
    input: { text: string; mediaReference?: { mediaId: string; type: string } },
  ): Promise<LiveTurnResult> {
    const customer = await this.conversationsService.findOrCreateCustomer(
      tenantId,
      LIVE_IDENTITY.channel,
      LIVE_IDENTITY.externalUserId,
    );
    const { conversation } = await this.conversationsService.findOrCreateConversation(
      tenantId,
      customer.id,
      LIVE_IDENTITY.channel,
      LIVE_IDENTITY.channelAccountId,
    );

    const text = input.text ?? '';
    // A photo is stored like an inbound Instagram photo, and like on Instagram
    // it is its own message, before the text. Catalog matching keeps the
    // reference as given, so a pasted catalog image URL still matches exactly.
    const attachment = input.mediaReference
      ? await this.media.attachmentFor(tenantId, input.mediaReference)
      : null;
    const separatePhoto = attachment?.type === 'customer_photo';
    const save = (body: string, attachments: MessageAttachment[] | null) =>
      this.conversationsService.saveMessage(
        conversation.id,
        tenantId,
        MessageDirection.Inbound,
        MessageRole.User,
        body,
        undefined,
        null,
        attachments,
      );
    if (separatePhoto) await save('', [attachment]);
    if (text.trim() || !separatePhoto) await save(text, attachment && !separatePhoto ? [attachment] : null);

    const result = await this.turnRunner.run({
      tenantId,
      conversationId: conversation.id,
      mode: 'demo',
      source: 'live_console',
      mediaReference: input.mediaReference,
    });
    const tools = toolNames(result.agent?.steps ?? []);
    const [first, ...rest] = result.messages;

    return {
      conversationId: conversation.id,
      message: text,
      mediaReference: input.mediaReference,
      ...(attachment?.url && { photoUrl: attachment.url }),
      ...(attachment?.error && { photoError: attachment.error }),
      classification: null,
      decision: result.handoff ? 'handoff' : result.committed.orderId ? 'create_draft_order' : 'reply',
      scenario: tools.length ? tools.join(', ') : null,
      replyText: first?.text ?? null,
      extraReplies: rest.map(bubble),
      imageUrls: first?.imageUrls,
      state: await this.liveState(tenantId, conversation.id, customer.id, result.handoff),
      trace: [
        ...(result.agent?.steps ?? []).flatMap((s) =>
          s.toolCalls.map((c) => `[${s.attempt}] ${c.toolName} ${JSON.stringify(c.input)}`),
        ),
        ...retryNotes(result.agent?.attempts ?? []),
        ...(result.status !== 'replied' && result.status !== 'handed_off' ? [`status: ${result.status}`] : []),
      ],
    };
  }

  /** Store a photo uploaded in the live console, for the next message to carry. */
  async uploadLivePhoto(tenantId: string, file: Buffer): Promise<MessageAttachment> {
    return this.media.storeFromBuffer(tenantId, file);
  }

  /** Wipe the live conversation so the next message starts fresh. */
  async resetLiveConversation(tenantId: string): Promise<void> {
    await this.scenarioRunner.cleanup(tenantId, LIVE_IDENTITY);
  }

  /** Persisted messages and the current order draft, for chat rehydration. */
  async getLiveConversation(tenantId: string): Promise<{
    conversationId: string | null;
    messages: Array<{ role: string; text: string | null; createdAt: Date; photoUrls?: string[] }>;
    state: Record<string, unknown>;
  }> {
    const rows: Array<{ id: string; customer_id: string }> = await this.dataSource.query(
      `SELECT conv.id, conv.customer_id FROM conversations conv
       JOIN customers cust ON conv.customer_id = cust.id
       WHERE cust.external_user_id = $1 AND cust.tenant_id = $2
       ORDER BY conv.last_message_at DESC NULLS LAST
       LIMIT 1`,
      [LIVE_IDENTITY.externalUserId, tenantId],
    );
    if (!rows[0]) return { conversationId: null, messages: [], state: {} };
    const full = await this.conversationsService.findById(rows[0].id);
    return {
      conversationId: rows[0].id,
      messages: full.messages.map((m) => {
        const photoUrls = (m.attachments ?? []).flatMap((a) => (a.url ? [a.url] : []));
        return { role: m.role, text: m.text, createdAt: m.createdAt, ...(photoUrls.length > 0 && { photoUrls }) };
      }),
      state: await this.liveState(tenantId, rows[0].id, rows[0].customer_id, null),
    };
  }

  /** Linked media mappings (product ↔ Instagram media id) for the story-reply picker. */
  async listLinkedMedia(
    tenantId: string,
  ): Promise<Array<{ instagramMediaId: string; mediaType: string; productTitle: string }>> {
    const rows: Array<{ instagram_media_id: string; media_type: string; title: string }> = await this.dataSource.query(
      `SELECT m.instagram_media_id, m.media_type, p.title
       FROM instagram_media_mappings m
       JOIN products p ON p.id = m.product_id
       WHERE m.tenant_id = $1 AND m.product_id IS NOT NULL
       ORDER BY p.title, m.media_type`,
      [tenantId],
    );
    return rows.map((r) => ({
      instagramMediaId: r.instagram_media_id,
      mediaType: r.media_type,
      productTitle: r.title,
    }));
  }

  private async liveState(
    tenantId: string,
    conversationId: string,
    customerId: string,
    handoff: { reason: string; summaryForManager: string | null } | null,
  ): Promise<Record<string, unknown>> {
    const settings = await this.storeSettings.load(tenantId);
    const draft = await this.drafts.getCurrentDraft({ tenantId, conversationId, customerId }, settings.checkoutFields);
    return { orderDraft: draftForModel(draft), ...(handoff && { handoff }) };
  }

  /** Deep-merges the scenario's override onto flow_config; returns the restore. */
  private async applyFlowConfigOverride(scenario: SimulatorScenario): Promise<() => Promise<void>> {
    if (!scenario.flowConfigOverride) return async () => {};
    const rows: Array<{ flow_config: Record<string, unknown> | null }> = await this.dataSource.query(
      `SELECT flow_config FROM store_configs WHERE tenant_id = $1 LIMIT 1`,
      [scenario.tenantId],
    );
    const original = rows[0]?.flow_config ?? {};
    await this.dataSource.query(`UPDATE store_configs SET flow_config = $1 WHERE tenant_id = $2`, [
      JSON.stringify(deepMerge(original, scenario.flowConfigOverride)),
      scenario.tenantId,
    ]);
    return async () => {
      await this.dataSource.query(`UPDATE store_configs SET flow_config = $1 WHERE tenant_id = $2`, [
        JSON.stringify(original),
        scenario.tenantId,
      ]);
    };
  }
}

function bubble(m: OutgoingMessage): { text: string; imageUrls?: string[] } {
  return { text: m.text, ...(m.imageUrls && { imageUrls: m.imageUrls }) };
}

function toolNames(steps: Array<{ toolCalls: Array<{ toolName: string }> }>): string[] {
  return [...new Set(steps.flatMap((s) => s.toolCalls.map((c) => c.toolName)))];
}

function retryNotes(attempts: ScenarioTurnLog['attempts']): string[] {
  return attempts.slice(0, -1).map((a, i) => {
    const problems = [...a.grounding.map((g) => `${g.kind} «${g.value}»`), ...a.style.map((s) => `«${s.match}»`)];
    return `attempt ${i + 1} retried: ${problems.join(', ')}`;
  });
}

function toTurnLog(log: ScenarioTurnLog): SimulatorTurnLog {
  const [first, ...rest] = log.messages;
  const tools = [...new Set(log.toolCalls.map((c) => c.toolName))];
  return {
    turnIndex: log.turnIndex,
    message: log.message,
    mediaReference: log.mediaReference,
    classification: null,
    decision: log.handoff
      ? 'handoff'
      : tools.includes('place_order') && log.orderPlaced
        ? 'create_draft_order'
        : 'reply',
    scenario: tools.length ? tools.join(', ') : null,
    replyText: first?.text ?? null,
    extraReplies: rest.map(bubble),
    imageUrls: first?.imageUrls,
    state: {
      orderDraft: log.draft,
      orderPlaced: log.orderPlaced,
      paymentDetailsSent: log.paymentDetailsSent,
      ...(log.handoff && { handoff: log.handoff }),
    },
    assertions: log.assertions,
    trace: [
      ...log.toolCalls.map((c) => `[${c.attempt}] ${c.toolName} ${JSON.stringify(c.input)}`),
      ...retryNotes(log.attempts),
      ...(log.legacyDropped.length ? [`legacy route checks dropped: ${log.legacyDropped.join(', ')}`] : []),
    ],
  };
}
