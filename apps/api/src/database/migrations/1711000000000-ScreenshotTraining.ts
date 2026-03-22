import { MigrationInterface, QueryRunner } from 'typeorm';

export class ScreenshotTraining1711000000000 implements MigrationInterface {
  name = 'ScreenshotTraining1711000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "screenshot_import_jobs" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "status" text NOT NULL DEFAULT 'pending',
        "created_by_user_id" uuid NOT NULL,
        "total_files" integer NOT NULL DEFAULT 0,
        "processed_files" integer NOT NULL DEFAULT 0,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "completed_at" timestamptz,
        CONSTRAINT "PK_screenshot_import_jobs" PRIMARY KEY ("id"),
        CONSTRAINT "FK_screenshot_import_jobs_tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_screenshot_import_jobs_user" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "screenshot_import_files" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "job_id" uuid NOT NULL,
        "tenant_id" uuid NOT NULL,
        "file_url" text NOT NULL,
        "file_name" text NOT NULL,
        "mime_type" text NOT NULL,
        "ocr_status" text NOT NULL DEFAULT 'pending',
        "extraction_status" text NOT NULL DEFAULT 'pending',
        "extracted_text_raw" text,
        "extraction_metadata" jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_screenshot_import_files" PRIMARY KEY ("id"),
        CONSTRAINT "FK_screenshot_import_files_job" FOREIGN KEY ("job_id") REFERENCES "screenshot_import_jobs"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_screenshot_import_files_tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "extracted_conversation_fragments" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "file_id" uuid NOT NULL,
        "tenant_id" uuid NOT NULL,
        "transcript_json" jsonb NOT NULL,
        "scenario_suggestion" text,
        "confidence_score" real NOT NULL DEFAULT 0,
        "review_status" text NOT NULL DEFAULT 'pending',
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_extracted_conversation_fragments" PRIMARY KEY ("id"),
        CONSTRAINT "FK_extracted_conversation_fragments_file" FOREIGN KEY ("file_id") REFERENCES "screenshot_import_files"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_extracted_conversation_fragments_tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "extracted_phrases" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "fragment_id" uuid NOT NULL,
        "phrase" text NOT NULL,
        "phrase_type" text NOT NULL,
        "scenario" text,
        "confidence_score" real NOT NULL DEFAULT 0,
        "approval_status" text NOT NULL DEFAULT 'pending',
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_extracted_phrases" PRIMARY KEY ("id"),
        CONSTRAINT "FK_extracted_phrases_fragment" FOREIGN KEY ("fragment_id") REFERENCES "extracted_conversation_fragments"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_extracted_phrases_tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "extracted_voice_signals" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "fragment_id" uuid NOT NULL,
        "signal_type" text NOT NULL,
        "signal_value" text NOT NULL,
        "evidence_text" text,
        "confidence_score" real NOT NULL DEFAULT 0,
        "approval_status" text NOT NULL DEFAULT 'pending',
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_extracted_voice_signals" PRIMARY KEY ("id"),
        CONSTRAINT "FK_extracted_voice_signals_fragment" FOREIGN KEY ("fragment_id") REFERENCES "extracted_conversation_fragments"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_extracted_voice_signals_tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_screenshot_import_jobs_tenant_id" ON "screenshot_import_jobs" ("tenant_id");
      CREATE INDEX "IDX_screenshot_import_files_job_id" ON "screenshot_import_files" ("job_id");
      CREATE INDEX "IDX_extracted_conversation_fragments_file_id" ON "extracted_conversation_fragments" ("file_id");
      CREATE INDEX "IDX_extracted_phrases_fragment_id" ON "extracted_phrases" ("fragment_id");
      CREATE INDEX "IDX_extracted_voice_signals_fragment_id" ON "extracted_voice_signals" ("fragment_id");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const tables = [
      'extracted_voice_signals',
      'extracted_phrases',
      'extracted_conversation_fragments',
      'screenshot_import_files',
      'screenshot_import_jobs',
    ];
    for (const table of tables) {
      await queryRunner.query(`DROP TABLE IF EXISTS "${table}" CASCADE`);
    }
  }
}
