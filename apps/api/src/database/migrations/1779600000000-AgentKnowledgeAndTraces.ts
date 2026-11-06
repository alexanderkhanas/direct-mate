import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Per-store knowledge doc and agent trace columns (v2 agent plan, Phase 1).
 *
 * `store_configs.knowledge_doc` is the store's own text about delivery,
 * payment, returns and fit — what a manager would just know. It goes into the
 * agent's system prompt as-is (Decision 4: one AI-friendly source per store, no
 * vector DB). Owner-facing, so it is plain text, not jsonb.
 *
 * `conversation_traces` gains what the agent produces instead of a classifier
 * label: the per-step tool calls and results (`agent_steps`), what the
 * grounding and style guards found (`guard_results`), which model answered
 * (`model` — stores can override it, so it is per row), and token usage
 * (`usage`). The classifier-era columns stay until the old engine is deleted.
 */
export class AgentKnowledgeAndTraces1779600000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE store_configs
        ADD COLUMN knowledge_doc TEXT NULL;
    `);
    await queryRunner.query(`
      ALTER TABLE conversation_traces
        ADD COLUMN agent_steps JSONB NULL,
        ADD COLUMN guard_results JSONB NULL,
        ADD COLUMN model TEXT NULL,
        ADD COLUMN usage JSONB NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE conversation_traces
        DROP COLUMN IF EXISTS usage,
        DROP COLUMN IF EXISTS model,
        DROP COLUMN IF EXISTS guard_results,
        DROP COLUMN IF EXISTS agent_steps;
    `);
    await queryRunner.query(
      `ALTER TABLE store_configs DROP COLUMN IF EXISTS knowledge_doc;`,
    );
  }
}
