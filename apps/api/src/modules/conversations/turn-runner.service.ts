import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';
import { ConversationStatus, MessageDirection, MessageRole } from '@direct-mate/shared';
import { returnedRows } from '../../common/db';
import { AgentService, trailingCustomerText } from '../agent/agent.service';
import { AgentStoreSettings, AgentStoreSettingsService } from '../agent/store-settings.service';
import { productsInReply } from '../agent/turn-products';
import type { AgentHistoryEntry, AgentTurnResult } from '../agent/agent.types';
import { OrderDraftService } from '../orders/order-draft.service';
import { OrdersService } from '../orders/orders.service';
import { Order } from '../orders/entities/order.entity';
import { TelegramService } from '../notifications/telegram.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { ContentMediaService } from '../content-media/content-media.service';
import { VoiceMessagesService } from '../customer-media/voice-messages.service';
import { ContentLinksService } from '../channels/instagram/content-links.service';
import { ContentQuestionsService } from '../channels/instagram/content-questions.service';
import { ConversationsService } from './conversations.service';
import { ConversationTracesService } from './conversation-traces.service';
import { HistoryBuilder } from './history.builder';
import { MediaContextResolver, MediaReference } from './media-context.resolver';
import type { TraceSource } from './entities/conversation-trace.entity';
import type { MessageAttachment } from './entities/message.entity';

/**
 * - `live`: every effect, including outside the system (Telegram, n8n order
 *   sync, manager notifications). Sending to the channel is the caller's job.
 * - `demo`: database effects only — orders are placed and payment details
 *   claimed, so the conversation's state stays true, but nothing leaves the
 *   system and a handoff doesn't pause the conversation. The demo widget, the
 *   simulator and dev tools use it.
 * - `dry_run`: nothing is committed; the composed messages and staged effects
 *   are returned and traced. Learning (shadow) mode uses it.
 */
export type TurnMode = 'live' | 'demo' | 'dry_run';

export interface TurnRunInput {
  tenantId: string;
  conversationId: string;
  mode: TurnMode;
  source: TraceSource;
  /**
   * What to match against the catalog. Omitted: whatever the customer's new
   * messages carry (photos, story and post replies, shared posts).
   */
  mediaReference?: MediaReference | null;
  modelOverride?: string;
  /** Catalog in the prompt for this turn only (simulator comparison runs). */
  catalogPrompt?: 'list' | 'overview';
  /** Answer even though the store is paused: the owner trying their bot before turning it on. */
  ignorePause?: boolean;
  /** Discard the reply if the customer wrote again while it was being prepared (Instagram). */
  supersede?: boolean;
  /** Extra context for this turn only, e.g. that the reply goes out as a comment's private reply. */
  notes?: string[];
}

export interface OutgoingMessage {
  kind: 'welcome' | 'reply' | 'payment_details' | 'handoff_announce';
  text: string;
  imageUrls?: string[];
  /** The saved message row (not in dry_run), so a channel can record delivery on it. */
  messageId?: string;
}

export interface TurnHandoff {
  reason: string;
  summaryForManager: string | null;
}

export interface TurnRunResult {
  status: 'replied' | 'handed_off' | 'skipped' | 'busy' | 'superseded';
  skipReason?: 'paused' | 'human_in_control' | 'nothing_to_answer' | 'subscription_inactive' | 'no_permission';
  /** In send order. Already saved as outbound messages unless the mode is dry_run. */
  messages: OutgoingMessage[];
  handoff: TurnHandoff | null;
  committed: { orderId: string | null; paymentDetailsSent: boolean };
  agent: AgentTurnResult | null;
  traceId: string;
}

const LEASE_SECONDS = 120;
const WELCOME_AGAIN_AFTER_DAYS = 30;
const MAX_IMAGES = 4;
const DEFAULT_MAX_MESSAGES_PER_HOUR = 60;
const MATCHABLE: ReadonlySet<MessageAttachment['type']> = new Set([
  'customer_photo',
  'story_reply',
  'post_reply',
  'post_share',
  'post_comment',
]);

export const DEFAULT_HANDOFF_ANNOUNCE = 'Передаю розмову менеджеру — він відповість вам тут найближчим часом.';
const FIRST_REPLY_NOTE =
  "This is your first reply to this customer. A welcome line introducing you as the shop's AI assistant " +
  'is sent just before it, so do not greet or introduce yourself.';

interface ConversationRow {
  id: string;
  tenant_id: string;
  customer_id: string;
  status: ConversationStatus;
}

/**
 * One customer turn, end to end — the single pipeline the demo widget, the
 * simulator, the manual reply API and (Phase 4) Instagram all use:
 *
 *  1. lease the conversation, so two runs never answer the same thread;
 *  2. gates: paused store, the owner's permission for the Direct (a live reply
 *     needs `reply_to_customers`, a learning draft `read_messages`), manager in
 *     control, expired subscription, and (live)
 *     a customer sending more messages an hour than any person would, which
 *     caps what a script can spend;
 *  3. history (with conversation boundaries, and the images of stories and
 *     posts the customer pointed at) and media context;
 *  4. the agent;
 *  5. drop the reply if the customer wrote again meanwhile (Instagram only);
 *  6. commit staged effects for the mode, then compose and save the messages
 *     — welcome line first on a first reply, the store's announce line last
 *     on a handoff;
 *  7. trace, release the lease.
 *
 * Any failure becomes an announced handoff, never a partial reply.
 */
@Injectable()
export class TurnRunner {
  private readonly logger = new Logger(TurnRunner.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly conversations: ConversationsService,
    private readonly traces: ConversationTracesService,
    private readonly history: HistoryBuilder,
    private readonly media: MediaContextResolver,
    private readonly agent: AgentService,
    private readonly storeSettings: AgentStoreSettingsService,
    private readonly subscriptions: SubscriptionsService,
    private readonly drafts: OrderDraftService,
    private readonly orders: OrdersService,
    private readonly telegram: TelegramService,
    private readonly config: ConfigService,
    private readonly contentMedia: ContentMediaService,
    private readonly contentLinks: ContentLinksService,
    private readonly contentQuestions: ContentQuestionsService,
    private readonly voice: VoiceMessagesService,
  ) {}

  async run(input: TurnRunInput): Promise<TurnRunResult> {
    const traceId = randomUUID();
    const startedAt = new Date();
    const empty = { orderId: null, paymentDetailsSent: false };

    if (!(await this.acquireLease(input.conversationId))) {
      return { status: 'busy', messages: [], handoff: null, committed: empty, agent: null, traceId };
    }

    let settings: AgentStoreSettings | null = null;
    let conversation: ConversationRow | null = null;
    let history: AgentHistoryEntry[] = [];
    let firstReply = false;
    let newConversation = false;
    try {
      conversation = await this.loadConversation(input);
      settings = await this.storeSettings.load(input.tenantId);
      const live = input.mode !== 'dry_run';

      if (live && settings.operatingMode === 'paused' && !input.ignorePause) return this.skipped('paused', traceId);
      // The owner's permissions, checked here whoever calls: nothing is sent without `reply_to_customers`, and
      // learning mode doesn't read the Direct without `read_messages`. Demo mode (test chat, simulator) needs neither.
      if (input.mode === 'live' && !settings.directReply) return this.skipped('no_permission', traceId);
      if (input.mode === 'dry_run' && !settings.directRead) return this.skipped('no_permission', traceId);
      if (live && conversation.status === ConversationStatus.HumanInControl) {
        return this.skipped('human_in_control', traceId);
      }

      firstReply = !(await this.botWroteRecently(conversation.customer_id));
      // Unpaid: the bot goes quiet and messages wait for the managers, as
      // before DirectMate. No reply, no handoff line, nothing the customer sees.
      if (!(await this.subscriptions.isActive(input.tenantId))) return this.skipped('subscription_inactive', traceId);
      newConversation = input.mode === 'live' && !(await this.botRepliedIn(conversation.id));
      if (newConversation && !(await this.subscriptions.hasRoomForConversation(input.tenantId))) {
        return this.skipped('subscription_inactive', traceId);
      }
      if (input.mode === 'live') {
        const limit = this.maxMessagesPerHour();
        if ((await this.messagesLastHour(conversation.customer_id)) > limit) {
          return this.finish(input, conversation, settings, history, startedAt, traceId, {
            reply: null,
            handoff: {
              reason: 'rate_limited',
              summaryForManager: `Клієнт надіслав понад ${limit} повідомлень за годину; AI-агент зупинився.`,
            },
            firstReply,
          });
        }
      }

      // Images of the stories, posts and reels in the new messages (a video's frames take seconds), and the transcripts
      // of voice messages, for the history.
      await Promise.all([
        this.contentMedia.prepare(input.tenantId, conversation.id),
        this.voice.prepare(input.tenantId, conversation.id),
      ]);
      const built = await this.history.buildTurn({
        id: conversation.id,
        tenantId: conversation.tenant_id,
        customerId: conversation.customer_id,
      });
      history = built.history;
      const lastSaid = [...history].reverse().find((e) => e.role !== 'note');
      if (lastSaid?.role !== 'customer') return this.skipped('nothing_to_answer', traceId);

      // From the rows the history was built from, so a note never points at an image the history doesn't show.
      const fromMessages = mediaReferences(built.newAttachments);
      const given = input.mediaReference;
      // A reference the caller passed is the same one its saved message carries, which has the copy and caption.
      // When the new messages point at nothing, the shop's story or post from earlier in the conversation stays in
      // view: «так, давайте» is still about it, and the owner's link to it still counts.
      const earlier =
        given === undefined && fromMessages.length === 0 && built.focus
          ? mediaReferences([built.focus]).map((r) => ({ ...r, earlier: true }))
          : [];
      const references =
        given === undefined
          ? [...fromMessages, ...earlier]
          : given
            ? [fromMessages.find((r) => r.type === given.type && r.mediaId === given.mediaId) ?? given]
            : [];
      const media = await this.media.resolve(
        input.tenantId,
        conversation.id,
        references,
        trailingCustomerText(history),
      );
      const notes = [
        ...media.notes,
        ...(firstReply && settings.welcomeLine ? [FIRST_REPLY_NOTE] : []),
        ...(input.notes ?? []),
      ];

      const agentResult = await this.agent.runTurn({
        tenantId: input.tenantId,
        conversationId: conversation.id,
        customerId: conversation.customer_id,
        history,
        notes,
        modelOverride: input.modelOverride,
        catalogPrompt: input.catalogPrompt,
      });

      if (input.supersede && (await this.hasNewerInbound(conversation.id, startedAt))) {
        await this.writeTrace(input, conversation, history, startedAt, traceId, agentResult, [], null, null, 'superseded');
        return { status: 'superseded', messages: [], handoff: null, committed: empty, agent: agentResult, traceId };
      }

      const result = await this.finish(input, conversation, settings, history, startedAt, traceId, {
        reply: agentResult.reply,
        handoff: agentResult.handoff,
        firstReply,
        agentResult,
        focusMediaId: built.focusMediaId,
      });
      // A conversation the bot took on counts toward the plan (and ends a trial at its limit).
      if (newConversation && result.messages.length > 0) {
        void this.subscriptions.recordConversation(input.tenantId).catch((e) =>
          this.logger.warn(`Counting the conversation failed: ${(e as Error).message}`),
        );
      }
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Turn failed for conversation ${input.conversationId}: ${message}`);
      if (!conversation) throw err;
      return this.finish(input, conversation, settings, history, startedAt, traceId, {
        reply: null,
        handoff: { reason: 'runner_error', summaryForManager: null },
        firstReply,
        error: message,
      });
    } finally {
      await this.releaseLease(input.conversationId);
    }
  }

  /** Commit effects, compose and save the messages, notify, trace. */
  private async finish(
    input: TurnRunInput,
    conversation: ConversationRow,
    settings: AgentStoreSettings | null,
    history: AgentHistoryEntry[],
    startedAt: Date,
    traceId: string,
    outcome: {
      reply: string | null;
      handoff: TurnHandoff | null;
      firstReply: boolean;
      agentResult?: AgentTurnResult;
      error?: string;
      /** The shop's content the customer pointed at last: what a `content_pick` is evidence for. */
      focusMediaId?: string | null;
    },
  ): Promise<TurnRunResult> {
    let { reply, handoff } = outcome;
    const effects = handoff?.reason === 'runner_error' ? [] : outcome.agentResult?.effects ?? [];
    const committed = { orderId: null as string | null, paymentDetailsSent: false };
    let paymentText: string | null = null;

    // Evidence for the content the customer pointed at: live only, never proof (the owner confirms).
    if (input.mode === 'live' && outcome.focusMediaId) {
      for (const effect of effects) {
        if (effect.type !== 'content_pick') continue;
        await this.contentLinks
          .addPick(input.tenantId, { mediaId: outcome.focusMediaId }, {
            productId: effect.productId,
            color: effect.color,
            conversationId: conversation.id,
          })
          .catch((err) => this.logger.warn(`Recording a content pick failed (non-fatal): ${(err as Error).message}`));
      }
    }

    // Place the order before anything is said about it.
    for (const effect of effects) {
      if (effect.type !== 'place_order' || input.mode === 'dry_run') continue;
      const placed = await this.drafts.placeOrder(input.tenantId, effect.checkoutSessionId, orderSource(input.source));
      if (!placed.ok) {
        // The reply likely says the order is placed; it isn't, so a person takes over.
        reply = null;
        handoff = { reason: 'order_failed', summaryForManager: `Не вдалося оформити замовлення: ${placed.error}` };
        break;
      }
      committed.orderId = placed.orderId;
      if (input.mode === 'live' && !placed.alreadyPlaced) {
        void this.announceOrder(input.tenantId, placed.orderId);
        // The order is evidence on this conversation's picks; a suggestion's first order asks the owner.
        void this.contentQuestions.afterOrder(input.tenantId, conversation.id, {
          orderId: placed.orderId,
          checkoutSessionId: effect.checkoutSessionId,
        });
      }
    }

    for (const effect of effects) {
      if (effect.type !== 'send_payment_details' || handoff?.reason === 'order_failed') continue;
      if (input.mode === 'dry_run') {
        paymentText = effect.text;
      } else if (await this.drafts.claimPaymentDetailsSend(input.tenantId, effect.checkoutSessionId)) {
        paymentText = effect.text;
        committed.paymentDetailsSent = true;
      }
    }

    const images = effects
      .flatMap((e) =>
        e.type === 'show_products' ? e.images.map((i) => i.url) : e.type === 'send_size_chart' ? [e.imageUrl] : [],
      )
      .slice(0, MAX_IMAGES);

    const messages: OutgoingMessage[] = [];
    if (outcome.firstReply && settings?.welcomeLine) messages.push({ kind: 'welcome', text: settings.welcomeLine });
    if (reply) messages.push({ kind: 'reply', text: reply, ...(images.length > 0 && { imageUrls: images }) });
    if (paymentText) messages.push({ kind: 'payment_details', text: paymentText });
    if (handoff) {
      messages.push({ kind: 'handoff_announce', text: settings?.handoffAnnounce ?? DEFAULT_HANDOFF_ANNOUNCE });
    }

    if (input.mode !== 'dry_run') {
      // The products the reply was about, so later turns can refer back to them (HistoryBuilder).
      const products = reply && outcome.agentResult ? productsInReply(outcome.agentResult.steps, reply) : [];
      for (const m of messages) {
        const saved = await this.conversations.saveMessage(
          conversation.id,
          input.tenantId,
          MessageDirection.Outbound,
          MessageRole.Assistant,
          m.text,
          undefined,
          {
            kind: m.kind,
            ...(m.imageUrls && { imageUrls: m.imageUrls }),
            ...(m.kind === 'reply' && products.length > 0 && { products }),
          },
        );
        if (saved?.id) m.messageId = saved.id;
      }
    }
    if (handoff && input.mode === 'live') await this.escalate(input, conversation, handoff, history);

    await this.writeTrace(
      input,
      conversation,
      history,
      startedAt,
      traceId,
      outcome.agentResult ?? null,
      messages,
      handoff,
      committed.orderId,
      outcome.error ?? null,
    );

    return {
      status: handoff ? 'handed_off' : 'replied',
      messages,
      handoff,
      committed,
      agent: outcome.agentResult ?? null,
      traceId,
    };
  }

  private skipped(skipReason: TurnRunResult['skipReason'], traceId: string): TurnRunResult {
    return {
      status: 'skipped',
      skipReason,
      messages: [],
      handoff: null,
      committed: { orderId: null, paymentDetailsSent: false },
      agent: null,
      traceId,
    };
  }

  private async loadConversation(input: TurnRunInput): Promise<ConversationRow> {
    const [row]: ConversationRow[] = await this.dataSource.query(
      `SELECT id, tenant_id, customer_id, status FROM conversations WHERE id = $1 AND tenant_id = $2`,
      [input.conversationId, input.tenantId],
    );
    if (!row) throw new Error(`Conversation ${input.conversationId} not found for tenant ${input.tenantId}`);
    return row;
  }

  /**
   * One atomic UPDATE claims the conversation until the lease runs out — no
   * pooled connection is held across the model calls, and a run that dies
   * leaves a lease that simply expires.
   */
  private async acquireLease(conversationId: string): Promise<boolean> {
    const rows = returnedRows<{ id: string }>(
      await this.dataSource.query(
        `UPDATE conversations SET processing_until = now() + make_interval(secs => $2)
          WHERE id = $1 AND (processing_until IS NULL OR processing_until < now())
          RETURNING id`,
        [conversationId, LEASE_SECONDS],
      ),
    );
    return rows.length > 0;
  }

  private async releaseLease(conversationId: string): Promise<void> {
    await this.dataSource
      .query(`UPDATE conversations SET processing_until = NULL WHERE id = $1`, [conversationId])
      .catch((err) => this.logger.error(`Failed to release lease on ${conversationId}: ${err}`));
  }

  /**
   * The welcome line introduces the bot to someone meeting it. It's one
   * Instagram thread per customer, so a new conversation after a day's gap
   * isn't a new acquaintance: welcome only when the bot hasn't written to this
   * customer, in any conversation, for WELCOME_AGAIN_AFTER_DAYS.
   */
  /** Whether the bot has answered in this conversation before (a new one counts toward the plan). */
  private async botRepliedIn(conversationId: string): Promise<boolean> {
    const rows = await this.dataSource.query(
      `SELECT 1 FROM messages WHERE conversation_id = $1 AND role = $2 LIMIT 1`,
      [conversationId, MessageRole.Assistant],
    );
    return rows.length > 0;
  }

  private async botWroteRecently(customerId: string): Promise<boolean> {
    const rows = await this.dataSource.query(
      `SELECT 1 FROM messages m JOIN conversations c ON c.id = m.conversation_id
        WHERE c.customer_id = $1 AND m.role = $2
          AND m.created_at > now() - make_interval(days => $3)
        LIMIT 1`,
      [customerId, MessageRole.Assistant, WELCOME_AGAIN_AFTER_DAYS],
    );
    return rows.length > 0;
  }

  /** What the customer's messages since the last reply point at: photos, and stories and posts with our copy and caption. */
  /** Inbound messages from this customer in the last hour, across conversations. */
  private async messagesLastHour(customerId: string): Promise<number> {
    const [row]: Array<{ n: number }> = await this.dataSource.query(
      `SELECT count(*)::int AS n FROM messages m JOIN conversations c ON c.id = m.conversation_id
        WHERE c.customer_id = $1 AND m.direction = $2 AND m.created_at > now() - interval '1 hour'`,
      [customerId, MessageDirection.Inbound],
    );
    return row?.n ?? 0;
  }

  private maxMessagesPerHour(): number {
    return this.config.get<number>('agent.maxCustomerMessagesPerHour') || DEFAULT_MAX_MESSAGES_PER_HOUR;
  }

  private async hasNewerInbound(conversationId: string, since: Date): Promise<boolean> {
    const rows = await this.dataSource.query(
      `SELECT 1 FROM messages WHERE conversation_id = $1 AND direction = $2 AND created_at > $3 LIMIT 1`,
      [conversationId, MessageDirection.Inbound, since],
    );
    return rows.length > 0;
  }

  private async escalate(
    input: TurnRunInput,
    conversation: ConversationRow,
    handoff: TurnHandoff,
    history: AgentHistoryEntry[],
  ): Promise<void> {
    await this.conversations.escalate(conversation.id, handoff.reason);
    const [customer]: Array<{ full_name: string | null; username: string | null }> = await this.dataSource.query(
      `SELECT full_name, username FROM customers WHERE id = $1`,
      [conversation.customer_id],
    );
    void this.telegram
      .notifyHandoff({
        tenantId: input.tenantId,
        customerName:
          [customer?.full_name, customer?.username && `@${customer.username}`].filter(Boolean).join(' ') || 'Клієнт',
        reason: handoff.reason,
        conversationId: conversation.id,
        lastMessage: trailingCustomerText(history),
        summary: handoff.summaryForManager ?? undefined,
      })
      .catch((err) => this.logger.error(`Telegram handoff notification failed: ${err}`));
  }

  /** n8n order sync and the manager's new-order message. Never fails the turn. */
  private async announceOrder(tenantId: string, orderId: string): Promise<void> {
    try {
      const order = await this.dataSource.getRepository(Order).findOneByOrFail({ id: orderId, tenantId });
      await this.orders.triggerExternalSync(order);
      const [items, delivery, customer]: [
        Array<{ title: string; color: string | null; size: string | null; qty: number; unit_price: string | null }>,
        Array<{
          full_name: string | null;
          phone: string | null;
          city: string | null;
          branch: string | null;
          payment_method: string | null;
          comment: string | null;
        }>,
        Array<{ full_name: string | null; username: string | null }>,
      ] = await Promise.all([
        this.dataSource.query(
          `SELECT p.title, v.color, v.size, oi.qty, oi.unit_price
             FROM order_items oi
             JOIN products p ON p.id = oi.product_id
             LEFT JOIN product_variants v ON v.id = oi.variant_id
            WHERE oi.order_id = $1
            ORDER BY oi.created_at`,
          [orderId],
        ),
        order.checkoutSessionId
          ? this.dataSource.query(
              `SELECT full_name, phone, city, branch, payment_method, comment
                 FROM checkout_customer_info WHERE checkout_session_id = $1 LIMIT 1`,
              [order.checkoutSessionId],
            )
          : Promise.resolve([]),
        order.customerId
          ? this.dataSource.query(`SELECT full_name, username FROM customers WHERE id = $1`, [order.customerId])
          : Promise.resolve([]),
      ]);
      const ig = customer[0];
      await this.telegram.notifyNewOrder({
        tenantId,
        orderId,
        items: items.map((i) => ({
          title: i.title,
          color: i.color,
          size: i.size,
          qty: Number(i.qty),
          unitPrice: i.unit_price != null ? Number(i.unit_price) : null,
        })),
        totalAmount: Number(order.totalAmount ?? 0),
        currency: order.currency,
        delivery: delivery[0]
          ? {
              fullName: delivery[0].full_name,
              phone: delivery[0].phone,
              city: delivery[0].city,
              branch: delivery[0].branch,
              paymentMethod: delivery[0].payment_method,
              comment: delivery[0].comment,
            }
          : null,
        customerName: [ig?.full_name, ig?.username && `@${ig.username}`].filter(Boolean).join(' ') || 'Клієнт',
      });
    } catch (err) {
      this.logger.error(`Order ${orderId} follow-up (sync / notification) failed: ${err}`);
    }
  }

  private async writeTrace(
    input: TurnRunInput,
    conversation: ConversationRow,
    history: AgentHistoryEntry[],
    startedAt: Date,
    traceId: string,
    agentResult: AgentTurnResult | null,
    messages: OutgoingMessage[],
    handoff: TurnHandoff | null,
    orderId: string | null,
    error: string | null,
  ): Promise<void> {
    await this.traces.persistAgentTurn({
      traceId,
      source: input.source,
      mode: input.mode,
      tenantId: input.tenantId,
      conversationId: conversation.id,
      customerId: conversation.customer_id,
      startedAt,
      inboundMessageText: trailingCustomerText(history) || null,
      inboundMediaRef: input.mediaReference ? { ...input.mediaReference } : null,
      decision: error && !agentResult ? 'error' : handoff ? 'handoff' : orderId ? 'create_draft_order' : 'reply',
      handoffReason: handoff?.reason ?? null,
      history,
      messages,
      agentResult,
      error,
    });
  }
}

function orderSource(source: TraceSource): string {
  if (source === 'demo_widget') return 'demo';
  if (source === 'simulator_cli' || source === 'simulator_scenario' || source === 'live_console') return 'simulator';
  if (source === 'owner_test') return 'test';
  return 'instagram_ai';
}

/** What the customer's new messages pointed at, for the resolver: a photo by its id; a story or post with its copy, caption and flags. */
function mediaReferences(attachments: MessageAttachment[]): MediaReference[] {
  return attachments
    .filter((a) => MATCHABLE.has(a.type) && !a.error)
    .map((a) =>
      a.type === 'customer_photo'
        ? { type: a.type, mediaId: a.mediaId }
        : {
            type: a.type,
            mediaId: a.mediaId,
            ...(a.url && { url: a.url, image: a.image }),
            ...(a.caption && { caption: a.caption }),
            ...(a.foreign && { foreign: true }),
            ...(a.reel && { reel: true }),
          },
    );
}
