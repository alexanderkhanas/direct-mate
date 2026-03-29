import { MigrationInterface, QueryRunner } from 'typeorm';

export class TelegramConnect1716000000000 implements MigrationInterface {
  name = 'TelegramConnect1716000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "telegram_connect_tokens" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "token" text NOT NULL,
        "expires_at" timestamptz NOT NULL,
        "used_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_telegram_connect_tokens" PRIMARY KEY ("id"),
        CONSTRAINT "FK_telegram_connect_tokens_tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE,
        CONSTRAINT "UQ_telegram_connect_tokens_token" UNIQUE ("token")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_telegram_connect_tokens_token" ON "telegram_connect_tokens" ("token")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "telegram_connect_tokens" CASCADE`);
  }
}
