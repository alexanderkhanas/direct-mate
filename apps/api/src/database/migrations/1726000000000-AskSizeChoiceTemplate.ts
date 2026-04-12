import { MigrationInterface, QueryRunner } from 'typeorm';

export class AskSizeChoiceTemplate1726000000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO "response_templates" ("tenant_id", "scenario", "stage", "blocks", "required_variables", "tone_tags", "priority")
      SELECT sc."tenant_id", v."scenario", v."stage", v."blocks"::jsonb, v."required_variables"::jsonb, v."tone_tags"::jsonb, v."priority"
      FROM "store_configs" sc
      CROSS JOIN (VALUES
        ('ask_size_choice', 'product_selected', '["У {product_name} є такі розміри: {variant_list}\\nЯкий розмір вам підходить? 💛"]', '["product_name","variant_list"]', '["warm"]', 90)
      ) AS v("scenario", "stage", "blocks", "required_variables", "tone_tags", "priority")
      WHERE NOT EXISTS (
        SELECT 1 FROM "response_templates" rt
        WHERE rt."tenant_id" = sc."tenant_id"
          AND rt."scenario" = 'ask_size_choice'
      )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM "response_templates" WHERE "scenario" = 'ask_size_choice'
    `);
  }
}
