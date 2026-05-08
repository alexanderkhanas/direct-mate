import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds a partial UNIQUE index on `products(tenant_id, external_product_id)`
 * to prevent duplicate-row imports.
 *
 * Why partial (WHERE external_product_id IS NOT NULL): we currently allow
 * `external_product_id` to be null for hand-curated products that don't
 * originate from a connector. Two NULLs would compare unequal in a strict
 * UNIQUE anyway, but being explicit documents intent.
 *
 * Background: a Torgsoft sync produced two products with
 * `external_product_id = '211A93241'` because the merchant's CSV had the
 * same Articul column with inconsistent trailing whitespace. The n8n
 * normalize node grouped on raw Articul (so two groups), but the DTO
 * shape step trimmed both to the same value. The catalog import service
 * builds its existing-products map BEFORE the per-product loop, so it
 * couldn't see the in-loop INSERT — both rows landed. On the next sync,
 * the lookup map silently kept only one duplicate; variants for the
 * other dup still owned the barcodes; new INSERTs hit the UNIQUE on
 * barcode → txn aborted. This index makes that class of bug fail-fast at
 * INSERT time with a clear constraint name, rather than corrupting state.
 *
 * The up() migration cleans pre-existing duplicates by keeping the row
 * with the most recent updated_at and deleting the rest (variants, media,
 * categories junction CASCADE off products).
 */
export class ProductsUniqueExternalId1738000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Resolve any existing duplicates: keep the most-recently-updated
    //    row per (tenant_id, external_product_id), delete the rest.
    await queryRunner.query(`
      DELETE FROM products
       WHERE id IN (
         SELECT id FROM (
           SELECT id, ROW_NUMBER() OVER (
             PARTITION BY tenant_id, external_product_id
             ORDER BY updated_at DESC, created_at DESC
           ) AS rn
           FROM products
           WHERE external_product_id IS NOT NULL
         ) ranked
         WHERE rn > 1
       )
    `);

    // 2. Add the partial unique index.
    await queryRunner.query(`
      CREATE UNIQUE INDEX idx_products_tenant_external_id_uniq
        ON products (tenant_id, external_product_id)
        WHERE external_product_id IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_products_tenant_external_id_uniq`,
    );
  }
}
