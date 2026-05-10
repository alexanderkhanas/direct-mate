import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds `products.search_keywords TEXT` for AI-enriched search surface.
 *
 * The Torgsoft / Shopify / OpenCart connectors deliver titles in the
 * brand's marketing voice (e.g. "Nanushka Сукня Artemiz з сітчастого
 * джерсі") with very few searchable synonyms. Customers ask in
 * Ukrainian with style / fabric / occasion words ("коктейльна сукня",
 * "сукня без рукавів", "вечірня з пайєтками"), or with the color in
 * the OPPOSITE language to whatever the catalog stores ("чорна" when
 * the variant is `Black`). The current ILIKE-on-title search misses
 * all of these.
 *
 * `search_keywords` is a fat Ukrainian-heavy text blob produced by the
 * same OpenAI tool-call that already runs in n8n's Normalize step. It
 * mixes color synonyms (Чорний / Чорна / Чорне / Black), garment
 * terms, style / fabric / occasion / fit tags. The search path
 * (`searchAllByTitle`) then ILIKEs against `(title OR search_keywords)`
 * so the existing query-by-keyword loop transparently picks them up.
 *
 * Stored as plain TEXT — pg_trgm index for fast ILIKE is added below.
 * No structured tags column yet; promote to jsonb only if the engine
 * grows faceted-search needs.
 */
export class ProductsSearchKeywords1778340000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE products
        ADD COLUMN search_keywords TEXT NULL
    `);

    // pg_trgm GIN index for fast case-insensitive LIKE / ILIKE on the
    // enriched blob. Enables sub-100ms %word% scans even when the
    // catalog grows past 10k products.
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS pg_trgm`);
    await queryRunner.query(`
      CREATE INDEX idx_products_search_keywords_trgm
        ON products
        USING gin (search_keywords gin_trgm_ops)
        WHERE search_keywords IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_products_search_keywords_trgm`);
    await queryRunner.query(`
      ALTER TABLE products DROP COLUMN IF EXISTS search_keywords
    `);
  }
}
