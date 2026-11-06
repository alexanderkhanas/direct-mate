import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Make an Instagram message id (`mid`) unique per tenant, so a redelivered
 * webhook can be dropped with `INSERT … ON CONFLICT DO NOTHING` instead of
 * becoming a second message (v2 agent plan, Phase 1 / Decision 5).
 *
 * Today nothing dedupes: `messages.external_message_id` has a plain index, so a
 * Meta retry stores the message twice and the debounce joins its text twice.
 * Outbound rows will carry the `mid` Meta returns for each send too, which is
 * what lets an `is_echo` webhook be recognised as the bot's own message.
 *
 * Existing duplicates are kept as rows: only their `external_message_id` is
 * cleared on every copy after the first, so history is unchanged and the index
 * can be built. Duplicate `pending_messages` rows are deleted instead — they are
 * debounce queue entries that live for seconds, and a second copy only makes
 * the joined text repeat.
 */
export class InboundMessageDedupe1779300000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE messages m
         SET external_message_id = NULL
        FROM (
          SELECT id,
                 ROW_NUMBER() OVER (
                   PARTITION BY tenant_id, external_message_id
                   ORDER BY created_at, id
                 ) AS rn
            FROM messages
           WHERE external_message_id IS NOT NULL
        ) dup
       WHERE m.id = dup.id
         AND dup.rn > 1;
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX uq_messages_tenant_external_message_id
        ON messages (tenant_id, external_message_id)
        WHERE external_message_id IS NOT NULL;
    `);

    await queryRunner.query(`
      DELETE FROM pending_messages p
       USING (
         SELECT id,
                ROW_NUMBER() OVER (
                  PARTITION BY tenant_id, message_id
                  ORDER BY created_at, id
                ) AS rn
           FROM pending_messages
       ) dup
       WHERE p.id = dup.id
         AND dup.rn > 1;
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX uq_pending_messages_tenant_message_id
        ON pending_messages (tenant_id, message_id);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS uq_pending_messages_tenant_message_id;`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS uq_messages_tenant_external_message_id;`,
    );
  }
}
