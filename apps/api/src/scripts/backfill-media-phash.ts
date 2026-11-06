// Fingerprint (dHash) catalog photos that have none, so a customer who sends
// the shop's own photo is matched without a vision call. Catalog sync does
// this for synced stores; seeded demo stores keep their photos under uploads/
// and were never fingerprinted.
//
// Idempotent: only rows with phash IS NULL are read; a photo that can't be
// opened stays NULL and is reported.
//
// Run via: npm run backfill:media-phash [-- --tenant demo-altamen]  (prod: backfill:prod:media-phash)

import 'reflect-metadata';
import { AppDataSource } from '../database/data-source';
import { ImageHashService } from '../modules/catalog/image-hash.service';

async function backfill(): Promise<void> {
  const slugArg = process.argv.indexOf('--tenant');
  const slug = slugArg > -1 ? process.argv[slugArg + 1] : null;

  await AppDataSource.initialize();
  try {
    const rows: Array<{ id: string; url: string; slug: string }> = await AppDataSource.query(
      `SELECT pm.id, pm.url, t.slug FROM product_media pm
         JOIN products p ON p.id = pm.product_id
         JOIN tenants t ON t.id = p.tenant_id
        WHERE pm.phash IS NULL AND ($1::text IS NULL OR t.slug = $1)
        ORDER BY t.slug, pm.created_at`,
      [slug],
    );
    const hashes = new ImageHashService();
    let done = 0;
    const failed: string[] = [];
    for (const row of rows) {
      const phash = await hashes.hashFromUrl(row.url);
      if (!phash) {
        failed.push(`${row.slug}: ${row.url}`);
        continue;
      }
      await AppDataSource.query(`UPDATE product_media SET phash = $1 WHERE id = $2`, [phash, row.id]);
      done++;
    }
    console.log(`✓ ${done} of ${rows.length} photos fingerprinted${slug ? ` (${slug})` : ''}`);
    if (failed.length > 0) console.log(`✗ could not open ${failed.length}:\n  ${failed.slice(0, 20).join('\n  ')}`);
  } finally {
    await AppDataSource.destroy();
  }
}

backfill().catch((err) => {
  console.error(err);
  process.exit(1);
});
