import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Two columns the v2 agent's turn runner needs (Phase 1).
 *
 * `conversations.processing_until` is a lease. A run claims a conversation with
 * one atomic `UPDATE … WHERE processing_until IS NULL OR processing_until < now()
 * RETURNING id`, so two runs never answer the same thread. It replaces
 * `pg_advisory_lock`, which `instagram.service.ts` takes and releases through
 * separate pooled connections (so the unlock can be a no-op), and it expires on
 * its own if the process dies mid-run.
 *
 * `messages.attachments` records what a message carried besides text — a story
 * or post reply, a shared post, a photo — in the same `{ type, mediaId }` shape
 * as the existing media reference. Media-only messages are stored today as
 * `text = ''`, so history can't tell the agent that a photo was sent.
 */
export class AgentConversationColumns1779400000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE conversations
        ADD COLUMN processing_until TIMESTAMPTZ NULL;
    `);
    await queryRunner.query(`
      ALTER TABLE messages
        ADD COLUMN attachments JSONB NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE messages DROP COLUMN IF EXISTS attachments;`,
    );
    await queryRunner.query(
      `ALTER TABLE conversations DROP COLUMN IF EXISTS processing_until;`,
    );
  }
}
