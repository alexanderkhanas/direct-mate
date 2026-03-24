import { MigrationInterface, QueryRunner } from 'typeorm';

export class TestRuns1713000000000 implements MigrationInterface {
  name = 'TestRuns1713000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
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
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "test_run_scenarios" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "test_runs" CASCADE`);
  }
}
