import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Setup from Claude (the MCP connector).
 *
 * `handoff_tokens`: a link Claude gives the owner for a step that needs a
 * browser (Instagram login, Shopify details). The link may open where the
 * owner isn't signed in, so the token is the authorization: one tenant, one
 * action, one use, ten minutes. Stored as a sha256.
 *
 * `setup_events`: one row the first time a store reaches a setup step through
 * a given source, for the funnel (authorized → catalog → Instagram → first
 * test → go-live).
 */
export class ClaudeSetup1780600000000 implements MigrationInterface {
  name = 'ClaudeSetup1780600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE handoff_tokens (
        token_hash text PRIMARY KEY,
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        action text NOT NULL CHECK (action IN ('instagram', 'shopify')),
        expires_at timestamptz NOT NULL,
        used_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE TABLE setup_events (
        id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        source text NOT NULL,
        step text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT setup_events_tenant_source_step UNIQUE (tenant_id, source, step)
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS setup_events`);
    await queryRunner.query(`DROP TABLE IF EXISTS handoff_tokens`);
  }
}
