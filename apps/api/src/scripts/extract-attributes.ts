/**
 * Read product attributes (formality, pattern, colour, fabric look, collar,
 * fit) from product photos for one store. The same extraction the background
 * worker runs (catalog/attributes), by hand.
 *
 * Usage (paid vision calls, about $0.002–0.003 per product on gpt-6.1-terra):
 *   cd apps/api && npm run attributes:extract -- --tenant demo-altamen
 *   ... --force              re-read every product, not only new or changed ones
 *   ... --overwrite-manual   also replace attributes edited in admin
 *   ... --limit 5            read at most 5 products
 *   ... --model gpt-5.4-mini try another model
 *   ... --concurrency 3      parallel calls (default 3)
 */

import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { DataSource } from 'typeorm';
import configuration from '../config/configuration';
import { DatabaseModule } from '../database/database.module';
import { CatalogModule } from '../modules/catalog/catalog.module';
import { ProductAttributesService } from '../modules/catalog/attributes/product-attributes.service';
import { describeLook } from '../modules/catalog/attributes/product-attributes';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true, load: [configuration] }), DatabaseModule, CatalogModule],
})
class ExtractAttributesModule {}

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const slug = arg('--tenant');
  if (!slug) throw new Error('Usage: npm run attributes:extract -- --tenant <slug> [--force] [--limit N] [--model id]');
  const limit = parseInt(arg('--limit') ?? '10000', 10);
  const concurrency = Math.max(1, parseInt(arg('--concurrency') ?? '3', 10));
  const modelId = arg('--model');

  const app = await NestFactory.createApplicationContext(ExtractAttributesModule, { logger: ['error', 'warn'] });
  try {
    const ds = app.get(DataSource);
    const service = app.get(ProductAttributesService);
    const [tenant]: Array<{ id: string }> = await ds.query(`SELECT id FROM tenants WHERE slug = $1`, [slug]);
    if (!tenant) throw new Error(`No tenant with slug ${slug}`);

    const ids = await service.findStale({
      tenantId: tenant.id,
      limit,
      backoffMinutes: 0,
      force: process.argv.includes('--force'),
    });
    console.log(`${ids.length} product(s) to read with ${modelId ?? service.modelId()}`);
    const titles = new Map<string, string>(
      (
        (await ds.query(`SELECT id, title FROM products WHERE id = ANY($1)`, [ids])) as Array<{ id: string; title: string }>
      ).map((r) => [r.id, r.title]),
    );

    const started = Date.now();
    let ok = 0;
    let failed = 0;
    const queue = [...ids];
    const work = async () => {
      for (let id = queue.shift(); id; id = queue.shift()) {
        const result = await service.extract(id, {
          tenantId: tenant.id,
          overwriteManual: process.argv.includes('--overwrite-manual'),
          modelId,
        });
        if (result.ok) {
          ok++;
          console.log(`  ✓ ${titles.get(id)} — ${describeLook(result.attributes, { withColour: true }) ?? '(nothing)'}`);
        } else {
          failed++;
          console.log(`  ✗ ${titles.get(id)} — ${result.error}`);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, ids.length) }, work));
    console.log(`\nDone: ${ok} read, ${failed} failed, ${Math.round((Date.now() - started) / 1000)}s`);
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
