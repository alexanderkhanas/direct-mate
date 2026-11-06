import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Visual attributes per product (formality, pattern, colour, fabric look,
 * collar, fit), read from the main photo by a vision model and editable in
 * admin. The agent's category listing shows them, so it can judge "a shirt
 * for a wedding" from what the product looks like rather than from keywords.
 *
 * `attributes` holds the values the agent sees. `attributes_meta` records
 * where each value came from (`ai` or `manual`, so re-extraction never
 * overwrites an edit), what the extraction read (a hash of title, category,
 * description and main photo, so a changed product is re-read), and the last
 * attempt for backoff.
 */
export class ProductAttributes1779700000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE products
        ADD COLUMN attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
        ADD COLUMN attributes_meta JSONB NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE products
        DROP COLUMN IF EXISTS attributes_meta,
        DROP COLUMN IF EXISTS attributes;
    `);
  }
}
