import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The classifier + template engine is gone (v2 Phase 5).
 *
 * The template tables are renamed to `archived_*`, not dropped: production
 * stores' templates are the only written record of their delivery, payment and
 * returns copy, which their knowledge docs are written from. Drop them once
 * every store has a knowledge doc.
 *
 * Dropped outright, because nothing reads them and they hold nothing worth
 * keeping:
 * - the old engine's trace columns (classifier output, template, memory
 *   snapshots, per-call OpenAI records, stage timings);
 * - the old engine's memory on `conversation_state` (the conversation's state
 *   row and its status stay);
 * - the YAML test runner's results (`test_runs`, `test_run_scenarios`).
 */
export class RetireTemplateEngine1779900000000 implements MigrationInterface {
  name = 'RetireTemplateEngine1779900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const table of ['response_templates', 'phrase_blocks', 'faq_items']) {
      await queryRunner.query(`ALTER TABLE "${table}" RENAME TO "archived_${table}"`);
      await queryRunner.query(
        `COMMENT ON TABLE "archived_${table}" IS 'v1 template engine, archived Nov 2026. Read-only; drop once every store has a knowledge doc.'`,
      );
    }

    await queryRunner.query(`
      ALTER TABLE "conversation_traces"
        DROP COLUMN "template_scenario",
        DROP COLUMN "stage_timings",
        DROP COLUMN "classifier_output",
        DROP COLUMN "openai_request_ids",
        DROP COLUMN "openai_calls",
        DROP COLUMN "memory_before",
        DROP COLUMN "memory_after"
    `);

    await queryRunner.query(`
      ALTER TABLE "conversation_state"
        DROP COLUMN "selected_product_id",
        DROP COLUMN "selected_variant_id",
        DROP COLUMN "active_checkout_session_id",
        DROP COLUMN "last_ai_confidence",
        DROP COLUMN "context_json"
    `);

    await queryRunner.query(`DROP TABLE IF EXISTS "test_run_scenarios"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "test_runs"`);
  }

  /** Brings back the tables and columns, empty: dropped data does not come back. */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "test_runs" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "status" text NOT NULL DEFAULT 'running',
        "total_scenarios" integer NOT NULL DEFAULT 0,
        "passed_scenarios" integer NOT NULL DEFAULT 0,
        "failed_scenarios" integer NOT NULL DEFAULT 0,
        "started_at" timestamptz NOT NULL DEFAULT now(),
        "completed_at" timestamptz,
        "created_by_user_id" uuid,
        CONSTRAINT "PK_test_runs" PRIMARY KEY ("id"),
        CONSTRAINT "FK_test_runs_tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_test_runs_user" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "test_run_scenarios" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "run_id" uuid NOT NULL,
        "scenario_name" text NOT NULL,
        "scenario_file" text NOT NULL,
        "status" text NOT NULL DEFAULT 'pending',
        "review_status" text NOT NULL DEFAULT 'pending',
        "review_comment" text,
        "steps" jsonb NOT NULL DEFAULT '[]',
        "duration_ms" integer,
        "error_message" text,
        CONSTRAINT "PK_test_run_scenarios" PRIMARY KEY ("id"),
        CONSTRAINT "FK_test_run_scenarios_run" FOREIGN KEY ("run_id") REFERENCES "test_runs"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_test_runs_tenant" ON "test_runs" ("tenant_id");
      CREATE INDEX "IDX_test_runs_started_at" ON "test_runs" ("started_at" DESC);
      CREATE INDEX "IDX_test_run_scenarios_run" ON "test_run_scenarios" ("run_id");
    `);

    await queryRunner.query(`
      ALTER TABLE "conversation_state"
        ADD COLUMN "selected_product_id" uuid,
        ADD COLUMN "selected_variant_id" uuid,
        ADD COLUMN "active_checkout_session_id" uuid,
        ADD COLUMN "last_ai_confidence" numeric(4,3),
        ADD COLUMN "context_json" jsonb
    `);

    await queryRunner.query(`
      ALTER TABLE "conversation_traces"
        ADD COLUMN "template_scenario" text,
        ADD COLUMN "stage_timings" jsonb NOT NULL DEFAULT '{}'::jsonb,
        ADD COLUMN "classifier_output" jsonb,
        ADD COLUMN "openai_request_ids" text[],
        ADD COLUMN "openai_calls" jsonb,
        ADD COLUMN "memory_before" jsonb,
        ADD COLUMN "memory_after" jsonb
    `);

    for (const table of ['response_templates', 'phrase_blocks', 'faq_items']) {
      await queryRunner.query(`COMMENT ON TABLE "archived_${table}" IS NULL`);
      await queryRunner.query(`ALTER TABLE "archived_${table}" RENAME TO "${table}"`);
    }
  }
}
