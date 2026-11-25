// A connect link for one store: a public page where the owner allows reading
// their Direct and connects Instagram, without signing in to the admin
// (modules/mcp/connect.controller.ts). For an owner we set the store up for,
// e.g. a prospect whose conversations we analyse.
//
//   npm run connect-link -- --tenant taptap [--days 7]
//   npm run connect-link:prod -- --tenant taptap          (on the server, compiled)
//
// Prints the link. It works until it expires or the store has Instagram connected.

import 'reflect-metadata';
import { AppDataSource } from '../database/data-source';
import { randomToken, tokenHash } from '../modules/mcp/oauth/pkce';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const slug = arg('tenant');
  const days = Number(arg('days') ?? 7);
  if (!slug || !Number.isFinite(days) || days <= 0 || days > 30) {
    console.error('Usage: connect-link --tenant <slug> [--days 1–30, default 7]');
    process.exit(1);
  }
  await AppDataSource.initialize();
  try {
    const [tenant]: Array<{ id: string; name: string; connected: boolean }> = await AppDataSource.query(
      `SELECT t.id, t.name,
              EXISTS (SELECT 1 FROM connections c
                       WHERE c.tenant_id = t.id AND c.type = 'instagram' AND c.status = 'connected') AS connected
         FROM tenants t WHERE t.slug = $1`,
      [slug],
    );
    if (!tenant) throw new Error(`No store with slug "${slug}"`);
    if (tenant.connected) throw new Error(`${tenant.name} already has Instagram connected: the link would open as used`);

    const token = randomToken();
    await AppDataSource.query(
      `INSERT INTO handoff_tokens (token_hash, tenant_id, action, expires_at)
       VALUES ($1, $2, 'connect', now() + make_interval(days => $3))`,
      [tokenHash(token), tenant.id, days],
    );
    const admin = process.env.ADMIN_BASE_URL ?? 'http://localhost:5173';
    console.log(`Connect link for ${tenant.name} (${slug}), valid ${days} day(s):`);
    console.log(`${admin}/connect?t=${token}`);
  } finally {
    await AppDataSource.destroy();
  }
}

main().catch((err) => {
  console.error(`✗ ${(err as Error).message}`);
  process.exit(1);
});
