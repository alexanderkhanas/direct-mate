import { MigrationInterface, QueryRunner } from 'typeorm';

export class VariantNotAvailableTemplate1729000000000
  implements MigrationInterface
{
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO "response_templates" ("tenant_id", "scenario", "stage", "blocks", "required_variables", "tone_tags", "priority")
      SELECT sc."tenant_id", v."scenario", v."stage", v."blocks"::jsonb, v."required_variables"::jsonb, v."tone_tags"::jsonb, v."priority"
      FROM "store_configs" sc
      CROSS JOIN (VALUES
        ('variant_not_available', NULL::varchar, '["На жаль, {requested_variant} немає в наявності.\\nДоступні варіанти:\\n{variant_list} 💛"]', '["requested_variant","variant_list"]', '["warm"]', 95)
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
      DELETE FROM "response_templates" WHERE "scenario" = 'variant_not_available'
    `);
  }
}
