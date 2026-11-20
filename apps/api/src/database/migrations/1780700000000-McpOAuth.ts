import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Sign-in for the Claude connector: DirectMate is the OAuth authorization
 * server for its own MCP endpoint.
 *
 * `oauth_clients`: an MCP client that registered itself (Claude, Claude Code).
 * Public clients: no secret, PKCE on every sign-in.
 * `oauth_requests`: one sign-in from start to code. `browser_hash` ties it to
 * the browser that started it; `tenant_id` is set once, when the owner allows it.
 * `mcp_grants`: «Claude may set up this store», until revoked.
 * `mcp_tokens`: access and refresh tokens of a grant, stored as sha256. A
 * refresh token works once.
 */
export class McpOAuth1780700000000 implements MigrationInterface {
  name = 'McpOAuth1780700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE oauth_clients (
        client_id text PRIMARY KEY,
        client_name text NOT NULL,
        redirect_uris jsonb NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE TABLE oauth_requests (
        id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
        client_id text NOT NULL REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
        redirect_uri text NOT NULL,
        code_challenge text NOT NULL,
        state text,
        resource text,
        browser_hash text NOT NULL,
        tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE,
        user_id uuid REFERENCES users(id) ON DELETE CASCADE,
        code_hash text UNIQUE,
        code_expires_at timestamptz,
        expires_at timestamptz NOT NULL,
        used_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE TABLE mcp_grants (
        id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        client_id text NOT NULL,
        client_name text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        last_used_at timestamptz,
        revoked_at timestamptz
      )
    `);
    await queryRunner.query(`CREATE INDEX mcp_grants_tenant_id ON mcp_grants (tenant_id)`);
    await queryRunner.query(`
      CREATE TABLE mcp_tokens (
        token_hash text PRIMARY KEY,
        grant_id uuid NOT NULL REFERENCES mcp_grants(id) ON DELETE CASCADE,
        kind text NOT NULL CHECK (kind IN ('access', 'refresh')),
        expires_at timestamptz NOT NULL,
        used_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE INDEX mcp_tokens_grant_id ON mcp_tokens (grant_id)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS mcp_tokens`);
    await queryRunner.query(`DROP TABLE IF EXISTS mcp_grants`);
    await queryRunner.query(`DROP TABLE IF EXISTS oauth_requests`);
    await queryRunner.query(`DROP TABLE IF EXISTS oauth_clients`);
  }
}
