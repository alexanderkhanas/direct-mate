import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The products a story, post or reel shows: several per piece of content (an
 * outfit story shows three or four), each with how it was found and how sure
 * it is.
 *
 * - `confirmed`: the owner linked or confirmed it, its caption names the SKU,
 *   or our copy is the catalog photo itself. The AI agent offers it alone.
 * - `suggested`: evidence only (customers chose it, the visual check). The AI
 *   agent shows it first among the closest, never as the item pictured.
 * - `rejected`: the owner said no. Never used, never suggested again.
 *
 * Existing links move here. Customer-photo matches (`media_type =
 * 'customer_photo'`) stay on `instagram_media_mappings`: they are a cache of
 * photo matching, not content.
 */
export class ContentProducts1780400000000 implements MigrationInterface {
  name = 'ContentProducts1780400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE content_products (
        id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        mapping_id uuid NOT NULL REFERENCES instagram_media_mappings(id) ON DELETE CASCADE,
        product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        color text,
        source text NOT NULL CHECK (source IN ('manual', 'caption_sku', 'same_image', 'conversation', 'vision')),
        status text NOT NULL CHECK (status IN ('suggested', 'confirmed', 'rejected')),
        confidence real,
        evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
        owner_asked_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX content_products_mapping_product_color ON content_products (mapping_id, product_id, (coalesce(color, '')))`,
    );
    await queryRunner.query(`CREATE INDEX content_products_tenant_status ON content_products (tenant_id, status)`);

    await queryRunner.query(`
      INSERT INTO content_products (tenant_id, mapping_id, product_id, color, source, status, confidence)
      SELECT m.tenant_id, m.id, m.product_id, m.linked_color,
             CASE m.match_method
               WHEN 'sku_from_caption' THEN 'caption_sku'
               WHEN 'ai_vision_match' THEN 'vision'
               ELSE 'manual'
             END,
             CASE WHEN m.match_method = 'ai_vision_match' OR NOT m.confirmed THEN 'suggested' ELSE 'confirmed' END,
             m.match_confidence
        FROM instagram_media_mappings m
        JOIN products p ON p.id = m.product_id
       WHERE m.product_id IS NOT NULL
         AND m.media_type <> 'customer_photo'
         AND coalesce(m.match_method, '') NOT LIKE 'customer_photo%'
      ON CONFLICT DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS content_products`);
  }
}
