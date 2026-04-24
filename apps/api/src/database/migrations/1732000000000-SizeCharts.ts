import { MigrationInterface, QueryRunner } from 'typeorm';

export class SizeCharts1732000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE size_charts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        image_path TEXT NOT NULL,
        categories TEXT[] NOT NULL DEFAULT '{}',
        brands TEXT[] NOT NULL DEFAULT '{}',
        is_default BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE INDEX idx_size_charts_tenant ON size_charts (tenant_id);
      CREATE INDEX idx_size_charts_brands ON size_charts USING GIN (brands);
      CREATE INDEX idx_size_charts_categories ON size_charts USING GIN (categories);
      CREATE UNIQUE INDEX uniq_default_per_tenant
        ON size_charts (tenant_id) WHERE is_default = TRUE;
    `);

    // Seed two templates under a single scenario 'show_size_chart'.
    // Higher-priority template requires brand+name; lower-priority is the
    // no-context fallback. The template engine picks the first template whose
    // required_variables are all filled, so brand-less requests land on the fallback.
    await queryRunner.query(`
      INSERT INTO "response_templates" ("tenant_id", "scenario", "stage", "blocks", "required_variables", "tone_tags", "priority")
      SELECT sc."tenant_id", v."scenario", v."stage", v."blocks"::jsonb, v."required_variables"::jsonb, v."tone_tags"::jsonb, v."priority"
      FROM "store_configs" sc
      CROSS JOIN (VALUES
        ('show_size_chart', 'product_discovery', '["Ось розмірна сітка для {brand} — {name} 💛"]', '["brand","name"]', '["warm"]', 90),
        ('show_size_chart', 'product_discovery', '["Ось наша розмірна сітка 💛"]', '[]', '["warm"]', 50)
      ) AS v("scenario", "stage", "blocks", "required_variables", "tone_tags", "priority")
      WHERE NOT EXISTS (
        SELECT 1 FROM "response_templates" rt
        WHERE rt."tenant_id" = sc."tenant_id"
          AND rt."scenario" = 'show_size_chart'
          AND rt."blocks"::text = v."blocks"
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM "response_templates" WHERE "scenario" = 'show_size_chart';
    `);
    await queryRunner.query(`DROP TABLE IF EXISTS size_charts;`);
  }
}
