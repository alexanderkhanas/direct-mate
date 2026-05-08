import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds `last_synced_at TIMESTAMPTZ` to both `products` and
 * `product_variants` so the admin UI can show "last seen in connector
 * feed" independently of `updated_at` ("last row mutation") and
 * independently of `stock_balances.last_synced_at` ("last quantity
 * change").
 *
 * Why a separate column: the catalog import path skips writes when no
 * column diff'd, which means a steady-state sync never bumps
 * `updated_at`. The previous workaround read freshness from
 * `stock_balances.last_synced_at`, which itself only ticks when qty
 * changes — so a no-op-qty sync looked as stale as a missing one.
 *
 * Backfill: copy `updated_at` so existing rows have a sensible starting
 * value (the last UPDATE we issued IS the last confirmed sync touch we
 * know about). The first real sync after migration will overwrite.
 */
export class ProductsLastSyncedAt1738100000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE products
        ADD COLUMN last_synced_at TIMESTAMPTZ NULL
    `);
    await queryRunner.query(`
      UPDATE products
         SET last_synced_at = updated_at
       WHERE last_synced_at IS NULL
    `);

    await queryRunner.query(`
      ALTER TABLE product_variants
        ADD COLUMN last_synced_at TIMESTAMPTZ NULL
    `);
    await queryRunner.query(`
      UPDATE product_variants
         SET last_synced_at = updated_at
       WHERE last_synced_at IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE product_variants
        DROP COLUMN IF EXISTS last_synced_at
    `);
    await queryRunner.query(`
      ALTER TABLE products
        DROP COLUMN IF EXISTS last_synced_at
    `);
  }
}
