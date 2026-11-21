import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The owner's two permissions for the store's Instagram Direct, independent of
 * each other:
 *
 * `tenant_settings.direct_read_allowed_at`: DirectMate may read the Direct:
 * the one-time history import and learning mode.
 * `tenant_settings.direct_reply_allowed_at`: the AI agent may answer customers
 * (active mode, private replies to comments).
 * Null = not allowed. With neither, incoming DMs aren't kept at all.
 *
 * `direct_permission_events`: every grant and withdrawal, who gave it and where
 * (admin, Claude). An owner's «no» is recorded too, so Claude asks once.
 *
 * Stores keep what they do today: an active store may reply; a store in
 * learning mode, or one that agreed to the history import, may read.
 */
export class DirectPermissions1780800000000 implements MigrationInterface {
  name = 'DirectPermissions1780800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE tenant_settings
        ADD COLUMN direct_read_allowed_at timestamptz,
        ADD COLUMN direct_reply_allowed_at timestamptz
    `);
    await queryRunner.query(`
      CREATE TABLE direct_permission_events (
        id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        permission text NOT NULL CHECK (permission IN ('read_messages', 'reply_to_customers')),
        allowed boolean NOT NULL,
        source text NOT NULL CHECK (source IN ('admin', 'claude', 'migration')),
        user_id uuid REFERENCES users(id) ON DELETE SET NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX idx_direct_permission_events_tenant ON direct_permission_events (tenant_id, permission, created_at DESC)`,
    );

    // Every store has a settings row to hold the flags.
    await queryRunner.query(`
      INSERT INTO tenant_settings (tenant_id)
      SELECT t.id FROM tenants t
       WHERE NOT EXISTS (SELECT 1 FROM tenant_settings s WHERE s.tenant_id = t.id)
    `);
    await queryRunner.query(`
      UPDATE tenant_settings s SET direct_reply_allowed_at = now()
        FROM store_configs c
       WHERE c.tenant_id = s.tenant_id AND c.operating_mode = 'active'
    `);
    await queryRunner.query(`
      UPDATE tenant_settings s SET direct_read_allowed_at = now()
       WHERE EXISTS (SELECT 1 FROM store_configs c WHERE c.tenant_id = s.tenant_id AND c.operating_mode = 'learning')
          OR EXISTS (SELECT 1 FROM tenant_onboarding o WHERE o.tenant_id = s.tenant_id AND o.history_import->>'consent' = 'true')
    `);
    // The history import keeps a copy of the read permission; it must say the same.
    await queryRunner.query(`
      INSERT INTO tenant_onboarding (tenant_id, history_import)
      SELECT s.tenant_id, jsonb_build_object('consent', true, 'status', 'idle')
        FROM tenant_settings s WHERE s.direct_read_allowed_at IS NOT NULL
      ON CONFLICT (tenant_id) DO UPDATE
        SET history_import = coalesce(tenant_onboarding.history_import, jsonb_build_object('status', 'idle'))
                             || jsonb_build_object('consent', true)
    `);
    await queryRunner.query(`
      INSERT INTO direct_permission_events (tenant_id, permission, allowed, source)
      SELECT tenant_id, 'reply_to_customers', true, 'migration' FROM tenant_settings WHERE direct_reply_allowed_at IS NOT NULL
      UNION ALL
      SELECT tenant_id, 'read_messages', true, 'migration' FROM tenant_settings WHERE direct_read_allowed_at IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE direct_permission_events`);
    await queryRunner.query(`
      ALTER TABLE tenant_settings
        DROP COLUMN direct_read_allowed_at,
        DROP COLUMN direct_reply_allowed_at
    `);
  }
}
