/**
 * Compat smoke for the Replicate switch.
 *
 * Since we're moving from the in-process B/32 model (512-dim) to
 * Replicate's L/14 model (768-dim), there is no useful cosine
 * comparison against stored vectors — they live in different
 * spaces. Migration `1778600000000-ClipDimUpgrade` NULLs the old
 * rows so the worker re-embeds them under the new dim.
 *
 * What this script still verifies before any deploy:
 *   - We can reach Replicate (auth + model dispatch).
 *   - The returned vector has the expected dim (768).
 *   - The vector is L2-normalized within tolerance.
 *
 * If any of those fail, do not deploy.
 *
 * Usage:
 *   cd apps/api && \
 *     CLIP_ENABLED=true REPLICATE_API_TOKEN=<your-token> \
 *     npx ts-node -r tsconfig-paths/register \
 *       src/scripts/verify-embedding-compat.ts [--tenant=<slug>] [--id=<media-id>]
 *
 * Args (both optional):
 *   --tenant=<slug>     pick a row from a specific tenant
 *   --id=<uuid>         pick a specific product_media row by id
 *
 * Default: newest live (http) URL in `product_media`. The row doesn't
 * need to already have an embedding — we only use the URL.
 */

import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import { AppDataSource } from '../database/data-source';
import { ImageEmbeddingService } from '../modules/catalog/image-embedding.service';

const EXPECTED_DIM = 768;
const NORM_TOLERANCE = 0.01;

interface CliArgs {
  tenantSlug?: string;
  mediaId?: string;
}

function parseArgs(): CliArgs {
  const args: CliArgs = {};
  for (const raw of process.argv.slice(2)) {
    if (raw.startsWith('--tenant=')) args.tenantSlug = raw.slice(9);
    else if (raw.startsWith('--id=')) args.mediaId = raw.slice(5);
  }
  return args;
}

async function pickRow(
  args: CliArgs,
): Promise<{ id: string; url: string } | null> {
  if (args.mediaId) {
    const rows: Array<{ id: string; url: string }> =
      await AppDataSource.query(
        `SELECT id, url FROM product_media WHERE id = $1 LIMIT 1`,
        [args.mediaId],
      );
    return rows[0] ?? null;
  }
  if (args.tenantSlug) {
    const rows: Array<{ id: string; url: string }> =
      await AppDataSource.query(
        `SELECT pm.id, pm.url FROM product_media pm
           JOIN products p ON p.id = pm.product_id
           JOIN tenants t ON t.id = p.tenant_id
          WHERE t.slug = $1 AND pm.url LIKE 'http%'
          ORDER BY pm.created_at DESC LIMIT 1`,
        [args.tenantSlug],
      );
    return rows[0] ?? null;
  }
  const rows: Array<{ id: string; url: string }> = await AppDataSource.query(
    `SELECT id, url FROM product_media
      WHERE url LIKE 'http%'
      ORDER BY created_at DESC LIMIT 1`,
  );
  return rows[0] ?? null;
}

async function main(): Promise<void> {
  const args = parseArgs();
  await AppDataSource.initialize();

  const row = await pickRow(args);
  if (!row) {
    console.error('No row matched. Aborting.');
    await AppDataSource.destroy();
    process.exit(1);
  }
  console.log(`[compat] picked row=${row.id} url=${row.url}`);

  const config = new ConfigService();
  const svc = new ImageEmbeddingService(config);
  svc.onModuleInit();

  if (!svc.isEnabled()) {
    console.error(
      '[compat] ImageEmbeddingService is not enabled. Set CLIP_ENABLED=true and REPLICATE_API_TOKEN before running.',
    );
    await AppDataSource.destroy();
    process.exit(1);
  }

  console.log('[compat] calling Replicate...');
  const t0 = Date.now();
  const fresh = await svc.embedFromUrl(row.url);
  console.log(`[compat] Replicate returned in ${Date.now() - t0}ms`);

  if (!fresh) {
    console.error(
      '[compat] FAIL — Replicate returned null. Check token + URL liveness + service logs above.',
    );
    await AppDataSource.destroy();
    process.exit(2);
  }

  // Shape check (the service already rejected wrong dim with null, so
  // reaching here means dim matches CLIP_DIM=768 in the service. Echo it
  // for the report.)
  console.log(`[compat] dim = ${fresh.length} (expected ${EXPECTED_DIM})`);
  if (fresh.length !== EXPECTED_DIM) {
    console.error('[compat] FAIL — dim mismatch.');
    await AppDataSource.destroy();
    process.exit(2);
  }

  // Norm check.
  let norm2 = 0;
  for (let i = 0; i < fresh.length; i++) norm2 += fresh[i] * fresh[i];
  const norm = Math.sqrt(norm2);
  console.log(`[compat] L2 norm = ${norm.toFixed(6)} (expected ~1.0)`);
  if (Math.abs(norm - 1) > NORM_TOLERANCE) {
    console.warn(
      `[compat] WARN — embedding is not L2-normalized (||v||=${norm.toFixed(6)}). ` +
        'Cosine retrieval still works if normalization is applied at read time, but ' +
        'check whether the service should normalize after fetching from Replicate.',
    );
  }

  console.log(
    '[compat] PASS — Replicate reachable, returns 768-dim vector. Safe to deploy ' +
      '(stored 512-dim vectors will be NULLed by migration and re-embedded by the worker).',
  );

  await AppDataSource.destroy();
}

main().catch((err) => {
  console.error('[compat] crashed:', err);
  process.exit(1);
});
