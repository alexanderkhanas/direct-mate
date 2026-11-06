import { Injectable, Logger } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { CheckoutSessionStatus, OrderStatus } from '@direct-mate/shared';
import { returnedRows } from '../../common/db';
import { effectivePrice } from '../../common/pricing';

/**
 * The v2 agent's order draft, stored as a checkout session (status
 * `collecting_customer_info → ready_for_draft_order → draft_created`) with its
 * items and customer info.
 *
 * What is in the order never depends on the model remembering the
 * conversation: every change goes through here, prices come from the catalog,
 * and stock is checked on add and again on placement. Each change runs in one
 * transaction that locks the conversation's open session, so parallel tool
 * calls in one turn can't add an item twice. The database guarantees the rest
 * (migration OrderDraftConstraints): one open session per conversation, one
 * order per session.
 *
 * Failures are returned, not thrown — the agent's tools pass the reason back
 * to the model, which can ask the customer to fix it.
 */

export type PaymentMethod = 'cod' | 'prepay';

export interface DraftScope {
  tenantId: string;
  conversationId: string;
  customerId: string;
}

export interface OrderDraftItem {
  variantId: string;
  productId: string;
  title: string;
  color: string | null;
  size: string | null;
  qty: number;
  unitPrice: number;
  currency: string;
}

export interface OrderDraftCustomer {
  fullName: string | null;
  phone: string | null;
  city: string | null;
  branch: string | null;
  paymentMethod: PaymentMethod | null;
  comment: string | null;
}

export interface OrderDraftView {
  sessionId: string;
  status: CheckoutSessionStatus;
  items: OrderDraftItem[];
  customer: OrderDraftCustomer;
  total: number;
  currency: string;
  /** Required fields still empty, by their `checkout_config.fields` names; 'items' when there are none. */
  missingFields: string[];
  complete: boolean;
  placedOrderId: string | null;
  paymentDetailsSentAt: Date | null;
}

export interface DraftPatch {
  addItem?: { variantId: string; qty?: number };
  removeVariantId?: string;
  customer?: Partial<Pick<OrderDraftCustomer, 'fullName' | 'phone' | 'city' | 'branch' | 'comment'>>;
  paymentMethod?: PaymentMethod;
}

export type DraftResult =
  | { ok: true; draft: OrderDraftView }
  | { ok: false; error: string; draft: OrderDraftView | null };

export type PlaceOrderResult =
  | { ok: true; orderId: string; alreadyPlaced: boolean }
  | { ok: false; error: string };

/** What a store requires when its `checkout_config.fields` is missing. */
export const DEFAULT_CHECKOUT_FIELDS = ['fullName', 'phone', 'city', 'novaPoshtaBranch'];

// `checkout_config.fields` names → where the value lives on the draft.
const FIELD_TO_CUSTOMER_KEY: Record<string, keyof OrderDraftCustomer> = {
  fullName: 'fullName',
  phone: 'phone',
  city: 'city',
  novaPoshtaBranch: 'branch',
  branch: 'branch',
  paymentMethod: 'paymentMethod',
};

const OPEN_STATUSES = [
  CheckoutSessionStatus.CollectingCustomerInfo,
  CheckoutSessionStatus.ReadyForDraftOrder,
];

const UNIQUE_VIOLATION = '23505';

/** Sellable quantity summed over a variant's stock rows (one per warehouse). */
function availableQtySql(variantIdExpr: string): string {
  return `(SELECT COALESCE(SUM(sb.available_qty - sb.reserved_qty - sb.pending_checkout_qty), 0)
             FROM stock_balances sb WHERE sb.variant_id = ${variantIdExpr})`;
}

/**
 * A Ukrainian number as +380XXXXXXXXX, or another country's number in
 * international form. Null when it can't be a phone number.
 */
export function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  if (/^380\d{9}$/.test(digits)) return `+${digits}`;
  if (/^0\d{9}$/.test(digits)) return `+38${digits}`;
  if (raw.trim().startsWith('+') && digits.length >= 10 && digits.length <= 15) return `+${digits}`;
  return null;
}

export function missingDraftFields(
  items: OrderDraftItem[],
  customer: OrderDraftCustomer,
  requiredFields: string[],
): string[] {
  const missing = items.length === 0 ? ['items'] : [];
  for (const field of requiredFields) {
    const key = FIELD_TO_CUSTOMER_KEY[field];
    if (key && !customer[key]) missing.push(field);
  }
  return missing;
}

@Injectable()
export class OrderDraftService {
  private readonly logger = new Logger(OrderDraftService.name);

  constructor(private readonly dataSource: DataSource) {}

  /**
   * The conversation's current draft: the open one, or else the most recently
   * placed one (so "where are the payment details?" after placing still sees
   * the order). Null when the conversation has neither.
   */
  async getCurrentDraft(scope: DraftScope, requiredFields: string[]): Promise<OrderDraftView | null> {
    const rows: Array<{ id: string }> = await this.dataSource.query(
      `SELECT id FROM checkout_sessions
        WHERE tenant_id = $1 AND conversation_id = $2
          AND status = ANY($3)
        ORDER BY (status <> $4) DESC, created_at DESC
        LIMIT 1`,
      [
        scope.tenantId,
        scope.conversationId,
        [...OPEN_STATUSES, CheckoutSessionStatus.DraftCreated],
        CheckoutSessionStatus.DraftCreated,
      ],
    );
    if (rows.length === 0) return null;
    return this.loadView(this.dataSource.manager, rows[0].id, requiredFields);
  }

  /** Apply a change to the conversation's open draft, creating it if needed. */
  async update(scope: DraftScope, patch: DraftPatch, requiredFields: string[]): Promise<DraftResult> {
    return this.dataSource.transaction(async (m) => {
      const sessionId = await this.lockOrCreateOpenSession(m, scope);

      if (patch.addItem) {
        const error = await this.upsertItem(m, scope.tenantId, sessionId, patch.addItem);
        if (error) return { ok: false, error, draft: await this.loadView(m, sessionId, requiredFields) };
      }

      if (patch.removeVariantId) {
        const removed = returnedRows<{ id: string }>(
          await m.query(
            `DELETE FROM checkout_items WHERE checkout_session_id = $1 AND variant_id = $2 RETURNING id`,
            [sessionId, patch.removeVariantId],
          ),
        );
        if (removed.length === 0) {
          return {
            ok: false,
            error: 'That item is not in the order draft.',
            draft: await this.loadView(m, sessionId, requiredFields),
          };
        }
      }

      if (patch.customer || patch.paymentMethod) {
        const error = await this.upsertCustomer(m, sessionId, patch);
        if (error) return { ok: false, error, draft: await this.loadView(m, sessionId, requiredFields) };
      }

      let view = await this.loadView(m, sessionId, requiredFields);
      const nextStatus = view.complete
        ? CheckoutSessionStatus.ReadyForDraftOrder
        : CheckoutSessionStatus.CollectingCustomerInfo;
      if (view.status !== nextStatus) {
        await m.query(`UPDATE checkout_sessions SET status = $2, updated_at = now() WHERE id = $1`, [
          sessionId,
          nextStatus,
        ]);
        view = { ...view, status: nextStatus };
      }
      return { ok: true, draft: view };
    });
  }

  /**
   * Turn a complete draft into an order. Safe to retry: a second call for the
   * same session returns the order the first one created.
   */
  async placeOrder(tenantId: string, sessionId: string, source: string): Promise<PlaceOrderResult> {
    try {
      return await this.dataSource.transaction(async (m) => {
        const sessions: Array<{ status: CheckoutSessionStatus; customer_id: string }> = await m.query(
          `SELECT status, customer_id FROM checkout_sessions
            WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
          [sessionId, tenantId],
        );
        if (sessions.length === 0) return { ok: false as const, error: 'Order draft not found.' };

        const existing = await this.findOrderId(m, sessionId);
        if (existing) return { ok: true as const, orderId: existing, alreadyPlaced: true };

        if (sessions[0].status !== CheckoutSessionStatus.ReadyForDraftOrder) {
          return { ok: false as const, error: 'The order draft is not complete yet.' };
        }

        const items: Array<{
          product_id: string;
          variant_id: string;
          qty: number;
          unit_price: string;
          currency: string;
          available: string;
          title: string;
        }> = await m.query(
          `SELECT ci.product_id, ci.variant_id, ci.qty, ci.unit_price, ci.currency, p.title,
                  ${availableQtySql('ci.variant_id')} AS available
             FROM checkout_items ci
             JOIN products p ON p.id = ci.product_id
            WHERE ci.checkout_session_id = $1
            ORDER BY ci.created_at`,
          [sessionId],
        );
        const soldOut = items.filter((i) => Number(i.available) < i.qty);
        if (soldOut.length > 0) {
          return {
            ok: false as const,
            error: `No longer in stock: ${soldOut.map((i) => i.title).join(', ')}.`,
          };
        }

        const total = items.reduce((sum, i) => sum + Number(i.unit_price) * i.qty, 0);
        const [order]: Array<{ id: string }> = await m.query(
          `INSERT INTO orders (tenant_id, checkout_session_id, customer_id, status,
                               total_amount, currency, source, external_sync_status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'none')
           RETURNING id`,
          [
            tenantId,
            sessionId,
            sessions[0].customer_id,
            OrderStatus.AwaitingManagerConfirmation,
            total,
            items[0]?.currency ?? 'UAH',
            source,
          ],
        );
        for (const i of items) {
          await m.query(
            `INSERT INTO order_items (order_id, product_id, variant_id, qty, unit_price, currency)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [order.id, i.product_id, i.variant_id, i.qty, i.unit_price, i.currency],
          );
        }
        await m.query(`UPDATE checkout_sessions SET status = $2, updated_at = now() WHERE id = $1`, [
          sessionId,
          CheckoutSessionStatus.DraftCreated,
        ]);
        return { ok: true as const, orderId: order.id, alreadyPlaced: false };
      });
    } catch (err) {
      // Lost a race with a concurrent placement of the same session: the
      // unique index on orders.checkout_session_id stopped the second order.
      if ((err as { code?: string }).code === UNIQUE_VIOLATION) {
        const existing = await this.findOrderId(this.dataSource.manager, sessionId);
        if (existing) return { ok: true, orderId: existing, alreadyPlaced: true };
      }
      throw err;
    }
  }

  /**
   * Claim the one-time right to send payment details for this draft. True
   * exactly once per session, however many times it is called.
   */
  async claimPaymentDetailsSend(tenantId: string, sessionId: string): Promise<boolean> {
    const rows = returnedRows<{ id: string }>(
      await this.dataSource.query(
        `UPDATE checkout_sessions SET payment_details_sent_at = now()
          WHERE id = $1 AND tenant_id = $2 AND payment_details_sent_at IS NULL
          RETURNING id`,
        [sessionId, tenantId],
      ),
    );
    return rows.length > 0;
  }

  // ─── internals ─────────────────────────────────────────────────

  private async lockOrCreateOpenSession(m: EntityManager, scope: DraftScope): Promise<string> {
    const select = () =>
      m.query(
        `SELECT id FROM checkout_sessions
          WHERE tenant_id = $1 AND conversation_id = $2 AND status = ANY($3)
          FOR UPDATE`,
        [scope.tenantId, scope.conversationId, OPEN_STATUSES],
      ) as Promise<Array<{ id: string }>>;

    const found = await select();
    if (found.length > 0) return found[0].id;

    const inserted: Array<{ id: string }> = await m.query(
      `INSERT INTO checkout_sessions (tenant_id, conversation_id, customer_id, status)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (conversation_id)
         WHERE status IN ('collecting_customer_info', 'ready_for_draft_order')
       DO NOTHING
       RETURNING id`,
      [scope.tenantId, scope.conversationId, scope.customerId, CheckoutSessionStatus.CollectingCustomerInfo],
    );
    if (inserted.length > 0) return inserted[0].id;

    // A concurrent transaction created it between our select and insert.
    const raced = await select();
    return raced[0].id;
  }

  private async upsertItem(
    m: EntityManager,
    tenantId: string,
    sessionId: string,
    add: { variantId: string; qty?: number },
  ): Promise<string | null> {
    const qty = Math.max(1, Math.floor(add.qty ?? 1));
    const variants: Array<{
      id: string;
      product_id: string;
      price: string;
      sale_price: string | null;
      currency: string;
      available: string;
    }> = await m.query(
      `SELECT v.id, v.product_id, v.price, v.sale_price, v.currency,
              ${availableQtySql('v.id')} AS available
         FROM product_variants v
         JOIN products p ON p.id = v.product_id
        WHERE v.id = $1 AND v.tenant_id = $2 AND v.active = true AND p.status = 'active'`,
      [add.variantId, tenantId],
    );
    if (variants.length === 0) return 'That variant does not exist in this store.';
    const v = variants[0];
    const available = Number(v.available);
    if (available < qty) {
      return available > 0 ? `Only ${available} left in stock.` : 'That variant is out of stock.';
    }

    const unitPrice = effectivePrice(Number(v.price), v.sale_price != null ? Number(v.sale_price) : null);
    const updated = returnedRows<{ id: string }>(
      await m.query(
        `UPDATE checkout_items SET qty = $3, unit_price = $4
          WHERE checkout_session_id = $1 AND variant_id = $2
          RETURNING id`,
        [sessionId, v.id, qty, unitPrice],
      ),
    );
    if (updated.length === 0) {
      await m.query(
        `INSERT INTO checkout_items (checkout_session_id, product_id, variant_id, qty, unit_price, currency)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [sessionId, v.product_id, v.id, qty, unitPrice, v.currency],
      );
    }
    return null;
  }

  private async upsertCustomer(m: EntityManager, sessionId: string, patch: DraftPatch): Promise<string | null> {
    const values: Partial<OrderDraftCustomer> = {};
    for (const [key, raw] of Object.entries(patch.customer ?? {})) {
      if (typeof raw !== 'string') continue;
      const trimmed = raw.trim();
      if (!trimmed) continue;
      values[key as keyof OrderDraftCustomer] = trimmed as never;
    }
    if (values.phone) {
      const phone = normalizePhone(values.phone);
      if (!phone) return `"${values.phone}" doesn't look like a phone number.`;
      values.phone = phone;
    }
    if (patch.paymentMethod) values.paymentMethod = patch.paymentMethod;
    if (Object.keys(values).length === 0) return null;

    // Only the fields being set; COALESCE keeps what was there before.
    await m.query(
      `INSERT INTO checkout_customer_info
              (checkout_session_id, full_name, phone, city, branch, payment_method, comment)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (checkout_session_id) DO UPDATE SET
         full_name      = COALESCE(EXCLUDED.full_name, checkout_customer_info.full_name),
         phone          = COALESCE(EXCLUDED.phone, checkout_customer_info.phone),
         city           = COALESCE(EXCLUDED.city, checkout_customer_info.city),
         branch         = COALESCE(EXCLUDED.branch, checkout_customer_info.branch),
         payment_method = COALESCE(EXCLUDED.payment_method, checkout_customer_info.payment_method),
         comment        = COALESCE(EXCLUDED.comment, checkout_customer_info.comment),
         updated_at     = now()`,
      [
        sessionId,
        values.fullName ?? null,
        values.phone ?? null,
        values.city ?? null,
        values.branch ?? null,
        values.paymentMethod ?? null,
        values.comment ?? null,
      ],
    );
    return null;
  }

  private async findOrderId(m: EntityManager, sessionId: string): Promise<string | null> {
    const rows: Array<{ id: string }> = await m.query(
      `SELECT id FROM orders WHERE checkout_session_id = $1 LIMIT 1`,
      [sessionId],
    );
    return rows[0]?.id ?? null;
  }

  private async loadView(m: EntityManager, sessionId: string, requiredFields: string[]): Promise<OrderDraftView> {
    const [session]: Array<{
      id: string;
      status: CheckoutSessionStatus;
      payment_details_sent_at: Date | null;
    }> = await m.query(
      `SELECT id, status, payment_details_sent_at FROM checkout_sessions WHERE id = $1`,
      [sessionId],
    );
    const itemRows: Array<{
      variant_id: string;
      product_id: string;
      title: string;
      color: string | null;
      size: string | null;
      qty: number;
      unit_price: string;
      currency: string;
    }> = await m.query(
      `SELECT ci.variant_id, ci.product_id, p.title, v.color, v.size, ci.qty, ci.unit_price, ci.currency
         FROM checkout_items ci
         JOIN products p ON p.id = ci.product_id
         JOIN product_variants v ON v.id = ci.variant_id
        WHERE ci.checkout_session_id = $1
        ORDER BY ci.created_at`,
      [sessionId],
    );
    const [info]: Array<{
      full_name: string | null;
      phone: string | null;
      city: string | null;
      branch: string | null;
      payment_method: string | null;
      comment: string | null;
    }> = await m.query(
      `SELECT full_name, phone, city, branch, payment_method, comment
         FROM checkout_customer_info WHERE checkout_session_id = $1`,
      [sessionId],
    );

    const items: OrderDraftItem[] = itemRows.map((r) => ({
      variantId: r.variant_id,
      productId: r.product_id,
      title: r.title,
      color: r.color,
      size: r.size,
      qty: r.qty,
      unitPrice: Number(r.unit_price),
      currency: r.currency,
    }));
    const paymentMethod =
      info?.payment_method === 'cod' || info?.payment_method === 'prepay' ? info.payment_method : null;
    const customer: OrderDraftCustomer = {
      fullName: info?.full_name ?? null,
      phone: info?.phone ?? null,
      city: info?.city ?? null,
      branch: info?.branch ?? null,
      paymentMethod,
      comment: info?.comment ?? null,
    };
    const missingFields = missingDraftFields(items, customer, requiredFields);

    return {
      sessionId: session.id,
      status: session.status,
      items,
      customer,
      total: items.reduce((sum, i) => sum + i.unitPrice * i.qty, 0),
      currency: items[0]?.currency ?? 'UAH',
      missingFields,
      complete: missingFields.length === 0,
      placedOrderId:
        session.status === CheckoutSessionStatus.DraftCreated ? await this.findOrderId(m, sessionId) : null,
      paymentDetailsSentAt: session.payment_details_sent_at,
    };
  }
}
