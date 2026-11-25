import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Connect links: a link we send an owner who hasn't set the store up
 * themselves (a prospect whose Direct we analyse). It opens a public page
 * where they allow reading messages and connect Instagram, with no admin
 * login. Kept in `handoff_tokens` as action `connect`, valid for days rather
 * than minutes; the permission it records has source `link`.
 */
export class ConnectLinks1781200000000 implements MigrationInterface {
  name = 'ConnectLinks1781200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE handoff_tokens DROP CONSTRAINT IF EXISTS handoff_tokens_action_check`);
    await queryRunner.query(
      `ALTER TABLE handoff_tokens ADD CONSTRAINT handoff_tokens_action_check CHECK (action IN ('instagram', 'shopify', 'connect'))`,
    );
    await queryRunner.query(`ALTER TABLE direct_permission_events DROP CONSTRAINT IF EXISTS direct_permission_events_source_check`);
    await queryRunner.query(
      `ALTER TABLE direct_permission_events ADD CONSTRAINT direct_permission_events_source_check
         CHECK (source IN ('admin', 'claude', 'migration', 'link'))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM handoff_tokens WHERE action = 'connect'`);
    await queryRunner.query(`ALTER TABLE handoff_tokens DROP CONSTRAINT IF EXISTS handoff_tokens_action_check`);
    await queryRunner.query(
      `ALTER TABLE handoff_tokens ADD CONSTRAINT handoff_tokens_action_check CHECK (action IN ('instagram', 'shopify'))`,
    );
    await queryRunner.query(`UPDATE direct_permission_events SET source = 'admin' WHERE source = 'link'`);
    await queryRunner.query(`ALTER TABLE direct_permission_events DROP CONSTRAINT IF EXISTS direct_permission_events_source_check`);
    await queryRunner.query(
      `ALTER TABLE direct_permission_events ADD CONSTRAINT direct_permission_events_source_check
         CHECK (source IN ('admin', 'claude', 'migration'))`,
    );
  }
}
