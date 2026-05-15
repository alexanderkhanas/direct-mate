import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddConversationTraceContext1779100000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE conversation_traces
        ADD COLUMN memory_before  JSONB,
        ADD COLUMN memory_after   JSONB,
        ADD COLUMN recent_messages JSONB,
        ADD COLUMN outbound_reply TEXT,
        ADD COLUMN openai_calls   JSONB;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE conversation_traces
        DROP COLUMN IF EXISTS memory_before,
        DROP COLUMN IF EXISTS memory_after,
        DROP COLUMN IF EXISTS recent_messages,
        DROP COLUMN IF EXISTS outbound_reply,
        DROP COLUMN IF EXISTS openai_calls;
    `);
  }
}
