import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { CheckoutSessionStatus, MessageRole } from '@direct-mate/shared';
import { localizeColor } from '../../common/color-i18n';
import { formatCurrency } from '../../common/format';
import type { AgentHistoryEntry } from '../agent/agent.types';
import type { MessageAttachment } from './entities/message.entity';

const HISTORY_LIMIT = 30;
const GAP_NOTE_AFTER_MS = 2 * 60 * 60 * 1000;
const EARLIER_WINDOW_DAYS = 14;
const EARLIER_TAIL = 6;
const RECENT_ORDERS = 3;

/** The current conversation's newest photos are re-sent as images, up to this many; older ones get a label. */
const MAX_PHOTOS = 10;

const ATTACHMENT_LABEL: Record<MessageAttachment['type'], string> = {
  customer_photo: '(sent a photo)',
  customer_video: "(sent a video; you can't watch videos, so ask for a photo or a description)",
  customer_audio: "(sent a voice message; you can't listen to it, so ask them to write)",
  customer_file: "(sent a file you can't open; ask what it is)",
  story_reply: '(replied to a story)',
  post_reply: '(replied to a post)',
  post_share: '(shared a post)',
};
const PHOTO_NOT_LOADED = "(sent a photo that couldn't be loaded; ask them to send it again if you need it)";
const PHOTO_DROPPED = '(sent a photo earlier in the conversation; it is no longer attached)';

interface MessageRow {
  role: MessageRole;
  text: string | null;
  attachments: MessageAttachment[] | null;
  created_at: Date;
}

/**
 * What the agent sees of the conversation (implementation plan, "Conversation
 * boundaries"):
 *
 * - the current conversation, verbatim, with a note where messages are more
 *   than 2 hours apart, so a next-morning reply reads as one;
 * - the customer's photos in it, as images on the messages they came with
 *   (the newest 10), so «є таке?» after a photo reads naturally on every
 *   later turn too. Prompt caching makes re-sending them cheap;
 * - for a returning customer, the tail of their previous conversation and any
 *   order they didn't finish then, labelled as earlier and context-only;
 * - their recent orders, from the database rather than anyone's memory.
 *
 * Where one conversation ends is decided in `findOrCreateConversation`; this
 * only reads.
 */
@Injectable()
export class HistoryBuilder {
  constructor(private readonly dataSource: DataSource) {}

  async build(conversation: { id: string; tenantId: string; customerId: string }): Promise<AgentHistoryEntry[]> {
    const [current, earlier, orders] = await Promise.all([
      this.messages(conversation.id, HISTORY_LIMIT),
      this.earlierConversation(conversation),
      this.recentOrders(conversation.tenantId, conversation.customerId),
    ]);

    const history: AgentHistoryEntry[] = [];
    if (earlier) history.push({ role: 'note', text: earlier });
    if (orders) history.push({ role: 'note', text: orders });

    const photos = new Set(
      current
        .filter((row) => row.role === MessageRole.User)
        .flatMap((row) => row.attachments ?? [])
        .filter((a) => a.type === 'customer_photo' && a.url && !a.error)
        .map((a) => a.url!)
        .slice(-MAX_PHOTOS),
    );

    let previousAt: number | null = null;
    for (const row of current) {
      const at = new Date(row.created_at).getTime();
      if (previousAt !== null && at - previousAt >= GAP_NOTE_AFTER_MS) {
        history.push({ role: 'note', text: `— ${describeGap(at - previousAt)} later —` });
      }
      previousAt = at;
      const entry = toEntry(row, photos);
      if (entry) history.push(entry);
    }
    return history;
  }

  private async messages(conversationId: string, limit: number): Promise<MessageRow[]> {
    const rows: MessageRow[] = await this.dataSource.query(
      `SELECT role, text, attachments, created_at FROM messages
        WHERE conversation_id = $1
        ORDER BY created_at DESC, id DESC
        LIMIT $2`,
      [conversationId, limit],
    );
    return rows.reverse();
  }

  private async earlierConversation(conversation: {
    id: string;
    tenantId: string;
    customerId: string;
  }): Promise<string | null> {
    const [previous]: Array<{ id: string; last_message_at: Date }> = await this.dataSource.query(
      `SELECT id, last_message_at FROM conversations
        WHERE tenant_id = $1 AND customer_id = $2 AND id <> $3
          AND last_message_at > now() - make_interval(days => $4)
        ORDER BY last_message_at DESC
        LIMIT 1`,
      [conversation.tenantId, conversation.customerId, conversation.id, EARLIER_WINDOW_DAYS],
    );
    if (!previous) return null;

    const tail = (await this.messages(previous.id, EARLIER_TAIL))
      .map((row) => toEntry(row, null))
      .filter((e): e is AgentHistoryEntry => e !== null && e.role !== 'note');
    if (tail.length === 0) return null;

    const lines = [
      `Earlier conversation with this customer, ${describeGap(Date.now() - new Date(previous.last_message_at).getTime())} ago. ` +
        "Context only: treat today's messages as a new request unless the customer clearly refers back to it.",
      ...tail.map((e) => `${e.role === 'customer' ? 'Customer' : e.role === 'manager' ? 'Manager' : 'Shop'}: ${e.text}`),
    ];

    const unfinished = await this.draftItems(previous.id);
    if (unfinished) {
      lines.push(
        `They didn't finish an order then: ${unfinished}. It is no longer active; offer to put it together again only if they ask.`,
      );
    }
    return lines.join('\n');
  }

  /** Items of the conversation's unplaced draft, if any. */
  private async draftItems(conversationId: string): Promise<string | null> {
    const rows: Array<{ title: string; color: string | null; size: string | null; qty: number }> = await this.dataSource.query(
      `SELECT p.title, v.color, v.size, ci.qty
         FROM checkout_sessions s
         JOIN checkout_items ci ON ci.checkout_session_id = s.id
         JOIN products p ON p.id = ci.product_id
         JOIN product_variants v ON v.id = ci.variant_id
        WHERE s.conversation_id = $1 AND s.status <> $2
        ORDER BY s.created_at DESC, ci.created_at`,
      [conversationId, CheckoutSessionStatus.DraftCreated],
    );
    return rows.length > 0 ? rows.map(describeItem).join('; ') : null;
  }

  private async recentOrders(tenantId: string, customerId: string): Promise<string | null> {
    const orders: Array<{ id: string; created_at: Date; status: string; total_amount: string | null; currency: string }> =
      await this.dataSource.query(
        `SELECT id, created_at, status, total_amount, currency FROM orders
          WHERE tenant_id = $1 AND customer_id = $2
          ORDER BY created_at DESC
          LIMIT $3`,
        [tenantId, customerId, RECENT_ORDERS],
      );
    if (orders.length === 0) return null;

    const items: Array<{ order_id: string; title: string; color: string | null; size: string | null; qty: number }> =
      await this.dataSource.query(
        `SELECT oi.order_id, p.title, v.color, v.size, oi.qty
           FROM order_items oi
           JOIN products p ON p.id = oi.product_id
           JOIN product_variants v ON v.id = oi.variant_id
          WHERE oi.order_id = ANY($1)`,
        [orders.map((o) => o.id)],
      );

    const lines = orders.map((o) => {
      const what = items.filter((i) => i.order_id === o.id).map(describeItem).join('; ') || 'items not recorded';
      const date = new Date(o.created_at).toLocaleDateString('uk-UA', { day: 'numeric', month: 'long' });
      const total = o.total_amount != null ? `, ${Number(o.total_amount)} ${formatCurrency(o.currency)}` : '';
      return `- ${date}: ${what}${total}; status ${o.status.replace(/_/g, ' ')}`;
    });
    return [
      "This customer's orders (from the shop's records). Placed orders can't be changed by you; changes go to a manager:",
      ...lines,
    ].join('\n');
  }
}

/** `photos`: our copies to attach as images; null for an earlier conversation, which gets labels only. */
function toEntry(row: MessageRow, photos: Set<string> | null): AgentHistoryEntry | null {
  const labels: string[] = [];
  const images: string[] = [];
  for (const attachment of row.attachments ?? []) {
    const { label, image } = describeAttachment(attachment, photos);
    labels.push(label);
    if (image) images.push(image);
  }
  const text = [...labels, row.text?.trim()].filter(Boolean).join(' ');
  if (!text) return null;
  switch (row.role) {
    case MessageRole.User:
      return { role: 'customer', text, ...(images.length > 0 && { images }) };
    case MessageRole.Assistant:
      return { role: 'bot', text };
    case MessageRole.Manager:
      return { role: 'manager', text };
    default:
      return null;
  }
}

function describeAttachment(a: MessageAttachment, photos: Set<string> | null): { label: string; image?: string } {
  const label = ATTACHMENT_LABEL[a.type] ?? '(sent media)';
  if (a.type !== 'customer_photo' || !photos) return { label };
  if (a.error) return { label: PHOTO_NOT_LOADED };
  // Photos from before we kept copies have only Instagram's (expired) link.
  if (!a.url) return { label };
  return photos.has(a.url) ? { label, image: a.url } : { label: PHOTO_DROPPED };
}

function describeItem(i: { title: string; color: string | null; size: string | null; qty: number }): string {
  const variant = [localizeColor(i.color), i.size].filter(Boolean).join(', ');
  return `${i.title}${variant ? ` (${variant})` : ''} ×${i.qty}`;
}

export function describeGap(ms: number): string {
  const hours = Math.max(Math.round(ms / (60 * 60 * 1000)), 1);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'}`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'}`;
}
