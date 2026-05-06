import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds the extended attribute fields Torgsoft (and future POS connectors)
 * provide:
 *
 * - products.material / gender / season / sale_price / model_name
 * - product_variants.sale_price / barcode (with tenant-scoped UNIQUE)
 * - product_variants.tenant_id (denormalized; required to express the
 *   tenant-scoped unique-barcode index — Postgres won't allow a
 *   subquery inside an index expression)
 * - new categories + product_categories tables (M2M, replaces single
 *   products.category as the source of truth — products.category column
 *   is kept for back-compat and is now denormalized to the first input
 *   category at sync time)
 *
 * All new columns are nullable except product_variants.tenant_id which
 * is backfilled from products.tenant_id and then set NOT NULL.
 *
 * Indexes are partial (WHERE NOT NULL) to keep them lean — most legacy
 * Shopify-synced rows have NULL for these columns.
 */
export class TorgsoftExtendedFields1737000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── products: extended attribute columns ──────────────────────────
    await queryRunner.query(`
      ALTER TABLE products
        ADD COLUMN IF NOT EXISTS material   TEXT,
        ADD COLUMN IF NOT EXISTS gender     TEXT,
        ADD COLUMN IF NOT EXISTS season     TEXT,
        ADD COLUMN IF NOT EXISTS sale_price NUMERIC(10, 2),
        ADD COLUMN IF NOT EXISTS model_name TEXT
    `);

    // Partial indexes (WHERE NOT NULL) — search filters never need to
    // match NULL, and the index is much smaller this way for tenants
    // whose rows mostly lack these fields.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_products_material
        ON products (tenant_id, lower(material))
        WHERE material IS NOT NULL
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_products_gender
        ON products (tenant_id, gender)
        WHERE gender IS NOT NULL
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_products_season
        ON products (tenant_id, season)
        WHERE season IS NOT NULL
    `);

    // ── product_variants: tenant_id (denormalized) ────────────────────
    await queryRunner.query(`
      ALTER TABLE product_variants
        ADD COLUMN IF NOT EXISTS tenant_id UUID
    `);
    // Backfill from products.tenant_id.
    await queryRunner.query(`
      UPDATE product_variants v
      SET tenant_id = p.tenant_id
      FROM products p
      WHERE p.id = v.product_id
        AND v.tenant_id IS NULL
    `);
    await queryRunner.query(`
      ALTER TABLE product_variants
        ALTER COLUMN tenant_id SET NOT NULL
    `);
    // Foreign key — keep referential integrity.
    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'fk_product_variants_tenant'
        ) THEN
          ALTER TABLE product_variants
            ADD CONSTRAINT fk_product_variants_tenant
            FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
        END IF;
      END $$;
    `);

    // ── product_variants: sale_price + barcode + tenant-scoped uniq ───
    await queryRunner.query(`
      ALTER TABLE product_variants
        ADD COLUMN IF NOT EXISTS sale_price NUMERIC(10, 2),
        ADD COLUMN IF NOT EXISTS barcode    TEXT
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_variants_tenant_barcode_uniq
        ON product_variants (tenant_id, barcode)
        WHERE barcode IS NOT NULL
    `);

    // ── categories ────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS categories (
        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        name        TEXT NOT NULL,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // Case-insensitive uniqueness within tenant: "Верхній одяг" and
    // "верхній одяг" collapse to one row at upsert time.
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_categories_tenant_lower_name_uniq
        ON categories (tenant_id, lower(name))
    `);

    // ── product_categories (junction) ─────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS product_categories (
        product_id   UUID NOT NULL REFERENCES products(id)   ON DELETE CASCADE,
        category_id  UUID NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (product_id, category_id)
      )
    `);

    // Reverse-lookup index — "list every product in category X" needs
    // to scan from category_id, but the PK is (product_id, category_id)
    // so the reverse direction has no usable index without this.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_product_categories_category
        ON product_categories (category_id)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS product_categories`);
    await queryRunner.query(`DROP TABLE IF EXISTS categories`);

    await queryRunner.query(`DROP INDEX IF EXISTS idx_variants_tenant_barcode_uniq`);
    await queryRunner.query(`
      ALTER TABLE product_variants
        DROP CONSTRAINT IF EXISTS fk_product_variants_tenant
    `);
    await queryRunner.query(`
      ALTER TABLE product_variants
        DROP COLUMN IF EXISTS sale_price,
        DROP COLUMN IF EXISTS barcode,
        DROP COLUMN IF EXISTS tenant_id
    `);

    await queryRunner.query(`DROP INDEX IF EXISTS idx_products_season`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_products_gender`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_products_material`);
    await queryRunner.query(`
      ALTER TABLE products
        DROP COLUMN IF EXISTS material,
        DROP COLUMN IF EXISTS gender,
        DROP COLUMN IF EXISTS season,
        DROP COLUMN IF EXISTS sale_price,
        DROP COLUMN IF EXISTS model_name
    `);
  }
}
