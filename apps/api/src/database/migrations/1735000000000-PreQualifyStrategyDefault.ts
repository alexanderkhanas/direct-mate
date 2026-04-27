import { MigrationInterface, QueryRunner } from 'typeorm';

export class PreQualifyStrategyDefault1735000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE store_configs
      SET flow_config = jsonb_set(
        flow_config,
        '{preQualifyStrategy}',
        '"after_search_offered"'::jsonb,
        true
      )
      WHERE (flow_config -> 'preQualify' ->> 'enabled')::boolean IS TRUE
        AND NOT (flow_config ? 'preQualifyStrategy');
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE store_configs
      SET flow_config = flow_config - 'preQualifyStrategy'
      WHERE flow_config ? 'preQualifyStrategy';
    `);
  }
}
