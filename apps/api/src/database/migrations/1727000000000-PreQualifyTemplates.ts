import { MigrationInterface, QueryRunner } from 'typeorm';

export class PreQualifyTemplates1727000000000
  implements MigrationInterface
{
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO "response_templates" ("tenant_id", "scenario", "stage", "blocks", "required_variables", "tone_tags", "priority")
      SELECT sc."tenant_id", v."scenario", v."stage", v."blocks"::jsonb, v."required_variables"::jsonb, v."tone_tags"::jsonb, v."priority"
      FROM "store_configs" sc
      CROSS JOIN (VALUES
        ('pre_qualify', NULL::varchar, '["Підкажіть ваш зріст та вагу, щоб підібрати розмір 💛"]', '[]', '["warm"]', 90),
        ('pre_qualify_with_price', NULL::varchar, '["Ціна {product_name} — {price}, в наявності розміри: {variant_list}.\\nМожу допомогти підібрати розмір, якщо напишете ваш зріст та вагу 💛"]', '["product_name","price","variant_list"]', '["warm"]', 90)
      ) AS v("scenario", "stage", "blocks", "required_variables", "tone_tags", "priority")
      WHERE NOT EXISTS (
        SELECT 1 FROM "response_templates" rt
        WHERE rt."tenant_id" = sc."tenant_id"
          AND rt."scenario" = v."scenario"
      )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM "response_templates" WHERE "scenario" IN ('pre_qualify', 'pre_qualify_with_price')
    `);
  }
}
