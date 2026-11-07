import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Instagram on the v2 agent (Phase 4).
 *
 * `conversations.reply_due_at` replaces `pending_messages`. Inbound messages
 * are saved to `messages` on arrival, so the debounce only needs a timer: each
 * message pushes it 5 seconds out, and the poller claims due conversations
 * with one atomic `UPDATE … RETURNING`. The old flush read and then deleted its
 * rows in two steps, so two pollers could both answer. `reply_rerun` records
 * that the last run was dropped because the customer wrote again, so the
 * re-run sends whatever it writes instead of waiting forever on a fast typist.
 *
 * `messages.delivery_status` ('sent' | 'failed') is set on bot messages sent
 * to Instagram. A message that never reached the customer is left out of the
 * agent's history.
 *
 * `instagram_sent_mids` holds the id Meta returns for every message we send —
 * text, image, comment private reply — so an `is_echo` webhook is recognised
 * as our own by lookup, not by the timing guesses it replaces. `message_id`
 * points at the row it was sent for, so a customer's quote-reply to one of the
 * bot's messages can show what they quoted.
 *
 * Messages still waiting in `pending_messages` are already in `messages`;
 * their conversations get a timer that is due now, then the table is dropped.
 */
export class InstagramAgentIntake1779800000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE conversations
        ADD COLUMN reply_due_at TIMESTAMPTZ NULL,
        ADD COLUMN reply_rerun BOOLEAN NOT NULL DEFAULT false;
    `);
    await queryRunner.query(`
      CREATE INDEX idx_conversations_reply_due_at ON conversations (reply_due_at)
        WHERE reply_due_at IS NOT NULL;
    `);
    await queryRunner.query(`ALTER TABLE messages ADD COLUMN delivery_status TEXT NULL;`);
    await queryRunner.query(`
      CREATE TABLE instagram_sent_mids (
        mid TEXT PRIMARY KEY,
        tenant_id UUID NOT NULL,
        conversation_id UUID NULL REFERENCES conversations(id) ON DELETE CASCADE,
        message_id UUID NULL REFERENCES messages(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
    await queryRunner.query(`CREATE INDEX idx_instagram_sent_mids_created_at ON instagram_sent_mids (created_at);`);

    await queryRunner.query(`
      UPDATE conversations c
         SET reply_due_at = now()
        FROM customers cu, pending_messages p
       WHERE cu.id = c.customer_id
         AND cu.tenant_id = p.tenant_id
         AND cu.external_user_id = p.external_user_id
         AND c.channel = 'instagram'
         AND c.channel_account_id = p.channel_account_id
         AND c.status IN ('active', 'human_in_control');
    `);
    await queryRunner.query(`DROP TABLE pending_messages;`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE pending_messages (
        id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
        debounce_key text NOT NULL,
        tenant_id uuid NOT NULL,
        external_user_id text NOT NULL,
        channel_account_id text NOT NULL,
        connection_id uuid NOT NULL,
        message_id text NOT NULL,
        message_text text NOT NULL,
        media_reference jsonb DEFAULT NULL,
        flush_at timestamptz NOT NULL,
        created_at timestamptz DEFAULT now()
      );
    `);
    await queryRunner.query(`CREATE INDEX "IDX_pending_messages_flush" ON pending_messages (flush_at);`);
    await queryRunner.query(`CREATE INDEX "IDX_pending_messages_key" ON pending_messages (debounce_key);`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX uq_pending_messages_tenant_message_id ON pending_messages (tenant_id, message_id);`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS instagram_sent_mids;`);
    await queryRunner.query(`ALTER TABLE messages DROP COLUMN IF EXISTS delivery_status;`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_conversations_reply_due_at;`);
    await queryRunner.query(`
      ALTER TABLE conversations
        DROP COLUMN IF EXISTS reply_rerun,
        DROP COLUMN IF EXISTS reply_due_at;
    `);
  }
}
