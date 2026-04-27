import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddBusinessTypeField1736000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE store_configs
      SET flow_config = jsonb_set(
        flow_config,
        '{businessType}',
        '"clothing"'::jsonb,
        true
      )
      WHERE tenant_id IN (SELECT id FROM tenants WHERE slug IN
        ('clothes-store','pilot','test','store','store-64ml','store-6zgt'))
        AND NOT (flow_config ? 'businessType');
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Mirror up()'s WHERE clause so the revert touches only tenants this
    // migration added the field to. Tenants seeded later (e.g. demo-cosmetics)
    // that explicitly set businessType keep their value untouched.
    await queryRunner.query(`
      UPDATE store_configs
      SET flow_config = flow_config - 'businessType'
      WHERE tenant_id IN (SELECT id FROM tenants WHERE slug IN
        ('clothes-store','pilot','test','store','store-64ml','store-6zgt'))
        AND flow_config ? 'businessType';
    `);
  }
}
