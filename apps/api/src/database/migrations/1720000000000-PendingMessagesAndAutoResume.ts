import { MigrationInterface, QueryRunner } from 'typeorm';

export class PendingMessagesAndAutoResume1720000000000 implements MigrationInterface {
  name = 'PendingMessagesAndAutoResume1720000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Add auto_resume_at column to conversations
    await queryRunner.query(`
      ALTER TABLE "conversations"
        ADD COLUMN "auto_resume_at" timestamptz DEFAULT NULL;
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_conversations_auto_resume" ON "conversations" ("auto_resume_at")
        WHERE "auto_resume_at" IS NOT NULL;
    `);

    // 2. Create pending_messages table for debounce buffer
    await queryRunner.query(`
      CREATE TABLE "pending_messages" (
        "id" uuid DEFAULT gen_random_uuid() PRIMARY KEY,
        "debounce_key" text NOT NULL,
        "tenant_id" uuid NOT NULL,
        "external_user_id" text NOT NULL,
        "channel_account_id" text NOT NULL,
        "connection_id" uuid NOT NULL,
        "message_id" text NOT NULL,
        "message_text" text NOT NULL,
        "media_reference" jsonb DEFAULT NULL,
        "flush_at" timestamptz NOT NULL,
        "created_at" timestamptz DEFAULT now()
      );
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_pending_messages_flush" ON "pending_messages" ("flush_at");
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_pending_messages_key" ON "pending_messages" ("debounce_key");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "pending_messages";`);
    await queryRunner.query(`ALTER TABLE "conversations" DROP COLUMN IF EXISTS "auto_resume_at";`);
  }
}
