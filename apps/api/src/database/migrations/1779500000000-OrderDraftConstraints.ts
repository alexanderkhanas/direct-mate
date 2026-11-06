import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Turn `checkout_sessions` into the agent's order draft (v2 agent plan, Phase 1).
 *
 * The model already exists — status `collecting_customer_info →
 * ready_for_draft_order → draft_created`, with items and customer info — but
 * nothing stopped a conversation from having several open drafts, an order
 * from being created twice for one draft, or payment details from going out
 * twice. These constraints make those side effects idempotent at the database,
 * not on the model's word:
 *
 *  - one OPEN session per conversation (`update_order_draft` upserts into it);
 *  - one order per session (`place_order` can be retried safely);
 *  - `payment_details_sent_at`, so `send_payment_details` sends at most once.
 *
 * Plus an index for the "customer's last orders" lookup the agent sees when a
 * returning customer starts a new conversation.
 *
 * Extra open sessions on one conversation are expired (newest kept): today only
 * the HTTP checkout API can leave a session open, and an older open one is an
 * abandoned draft. Duplicate orders for one session are NOT touched — there is
 * no safe automatic choice between two orders — so the migration stops and
 * says which sessions to look at.
 */
export class OrderDraftConstraints1779500000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    const duplicateOrders: Array<{ checkout_session_id: string; orders: string }> =
      await queryRunner.query(`
        SELECT checkout_session_id, COUNT(*)::text AS orders
          FROM orders
         WHERE checkout_session_id IS NOT NULL
         GROUP BY checkout_session_id
        HAVING COUNT(*) > 1;
      `);
    if (duplicateOrders.length > 0) {
      const list = duplicateOrders
        .map((r) => `${r.checkout_session_id} (${r.orders} orders)`)
        .join(', ');
      throw new Error(
        `Cannot make orders.checkout_session_id unique: these checkout sessions ` +
          `have more than one order: ${list}. Resolve them by hand, then rerun.`,
      );
    }

    await queryRunner.query(`
      ALTER TABLE checkout_sessions
        ADD COLUMN payment_details_sent_at TIMESTAMPTZ NULL;
    `);

    await queryRunner.query(`
      UPDATE checkout_sessions s
         SET status = 'expired', updated_at = now()
        FROM (
          SELECT id,
                 ROW_NUMBER() OVER (
                   PARTITION BY conversation_id
                   ORDER BY created_at DESC, id DESC
                 ) AS rn
            FROM checkout_sessions
           WHERE status IN ('collecting_customer_info', 'ready_for_draft_order')
        ) extra
       WHERE s.id = extra.id
         AND extra.rn > 1;
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX uq_checkout_sessions_open_per_conversation
        ON checkout_sessions (conversation_id)
        WHERE status IN ('collecting_customer_info', 'ready_for_draft_order');
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX uq_orders_checkout_session_id
        ON orders (checkout_session_id)
        WHERE checkout_session_id IS NOT NULL;
    `);
    await queryRunner.query(`
      CREATE INDEX idx_orders_tenant_customer_created
        ON orders (tenant_id, customer_id, created_at DESC);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_orders_tenant_customer_created;`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS uq_orders_checkout_session_id;`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS uq_checkout_sessions_open_per_conversation;`,
    );
    await queryRunner.query(
      `ALTER TABLE checkout_sessions DROP COLUMN IF EXISTS payment_details_sent_at;`,
    );
  }
}
