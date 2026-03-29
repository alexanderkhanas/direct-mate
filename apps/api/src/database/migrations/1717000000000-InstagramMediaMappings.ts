import { MigrationInterface, QueryRunner } from 'typeorm';

export class InstagramMediaMappings1717000000000 implements MigrationInterface {
  name = 'InstagramMediaMappings1717000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "instagram_media_mappings" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
        "instagram_media_id" text NOT NULL,
        "media_type" text NOT NULL DEFAULT 'post',
        "product_id" uuid REFERENCES "products"("id") ON DELETE SET NULL,
        "variant_id" uuid REFERENCES "product_variants"("id") ON DELETE SET NULL,
        "caption" text,
        "media_url" text,
        "permalink" text,
        "match_method" text,
        "match_confidence" real,
        "confirmed" boolean NOT NULL DEFAULT false,
        "expires_at" timestamptz,
        "fetched_at" timestamptz NOT NULL DEFAULT now(),
        "created_at" timestamptz NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "idx_media_mappings_tenant_media"
        ON "instagram_media_mappings" ("tenant_id", "instagram_media_id")
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_media_mappings_product"
        ON "instagram_media_mappings" ("product_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "instagram_media_mappings" CASCADE`);
  }
}
