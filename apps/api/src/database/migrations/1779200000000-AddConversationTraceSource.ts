import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Tag every conversation_trace with the environment that produced it.
 *
 * Existing rows become 'unknown' rather than 'instagram': at the time of this
 * migration the traces table mixes real webhook traffic with Live-DM-console
 * and simulator runs, and there is no reliable way to tell them apart after the
 * fact — which is exactly the ambiguity this column removes. Claiming they were
 * all production would be worse than admitting we don't know.
 */
export class AddConversationTraceSource1779200000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE conversation_traces
        ADD COLUMN source TEXT NOT NULL DEFAULT 'unknown';
    `);
    await queryRunner.query(`
      CREATE INDEX idx_conversation_traces_source
        ON conversation_traces (source);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_conversation_traces_source;`,
    );
    await queryRunner.query(
      `ALTER TABLE conversation_traces DROP COLUMN IF EXISTS source;`,
    );
  }
}
