import { MigrationInterface, QueryRunner } from 'typeorm';

export class ProductSku1718000000000 implements MigrationInterface {
  name = 'ProductSku1718000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE SEQUENCE IF NOT EXISTS "product_sku_seq"`);
    await queryRunner.query(`ALTER TABLE "products" ADD COLUMN "sku" text DEFAULT nextval('product_sku_seq')::text`);
    await queryRunner.query(`UPDATE "products" SET "sku" = nextval('product_sku_seq')::text WHERE "sku" IS NULL`);
    await queryRunner.query(`CREATE INDEX "idx_products_sku" ON "products" ("tenant_id", "sku")`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_products_sku"`);
    await queryRunner.query(`ALTER TABLE "products" DROP COLUMN "sku"`);
    await queryRunner.query(`DROP SEQUENCE IF EXISTS "product_sku_seq"`);
  }
}
