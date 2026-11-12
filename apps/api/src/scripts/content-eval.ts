/**
 * How good is the visual check? Runs it (no writes) on every story, post or
 * reel whose products are confirmed (by the owner, a caption SKU or the same
 * image: the answer key), and reports how often «same» named the right
 * product. Turn on «same» as certain only if it is almost never wrong.
 *
 * Usage (paid: two vision calls per piece of content):
 *   cd apps/api && npm run content:eval -- --tenant demo-altamen
 *   ... --limit 20          check at most 20 pieces of content (newest first)
 *   ... --model gpt-5.4     try another model (default CONTENT_VISION_MODEL)
 *
 * First confirm ~20–30 pieces of content on the Content page. Meta's own
 * links expire within a day, so content without our copy (`image_path`) may
 * fail to load; those are counted, not judged.
 */

import './no-background-workers';
import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { DataSource } from 'typeorm';
import configuration from '../config/configuration';
import { DatabaseModule } from '../database/database.module';
import { InstagramContentModule } from '../modules/channels/instagram/instagram-content.module';
import { ASK_AT, ContentVerifierService } from '../modules/channels/instagram/content-verifier.service';

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

// Before the configuration is read.
const model = arg('--model');
if (model) process.env.CONTENT_VISION_MODEL = model;

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true, load: [configuration] }), DatabaseModule, InstagramContentModule],
})
class ContentEvalModule {}

interface Row {
  id: string;
  instagram_media_id: string;
  image_path: string | null;
  thumbnail_url: string | null;
  media_url: string | null;
  media_type: string;
  caption: string | null;
  confirmed: string[];
  titles: string[];
}

async function main() {
  const slug = arg('--tenant');
  if (!slug) throw new Error('Usage: npm run content:eval -- --tenant <slug> [--limit N] [--model id]');
  const limit = parseInt(arg('--limit') ?? '30', 10);

  const app = await NestFactory.createApplicationContext(ContentEvalModule, { logger: ['error', 'warn'] });
  const db = app.get(DataSource);
  const verifier = app.get(ContentVerifierService);

  const [tenant]: Array<{ id: string }> = await db.query(`SELECT id FROM tenants WHERE slug = $1`, [slug]);
  if (!tenant) throw new Error(`No tenant ${slug}`);

  const rows: Row[] = await db.query(
    `SELECT m.id, m.instagram_media_id, m.image_path, m.thumbnail_url, m.media_url, m.media_type, m.caption,
            array_agg(cp.product_id::text) AS confirmed, array_agg(p.title) AS titles
       FROM instagram_media_mappings m
       JOIN content_products cp ON cp.mapping_id = m.id AND cp.status = 'confirmed'
       JOIN products p ON p.id = cp.product_id
      WHERE m.tenant_id = $1
      GROUP BY m.id
      ORDER BY m.created_at DESC
      LIMIT $2`,
    [tenant.id, limit],
  );
  console.log(`${rows.length} pieces of content with confirmed products in ${slug} (model ${process.env.CONTENT_VISION_MODEL || 'default'})\n`);

  const tally = { right: 0, wrong: 0, rightSure: 0, wrongSure: 0, unsure: 0, none: 0, notCandidate: 0, failed: 0, noPicture: 0 };
  let inputTokens = 0;
  let outputTokens = 0;

  for (const row of rows) {
    const image = row.image_path ?? (row.media_type === 'video' ? row.thumbnail_url : row.media_url ?? row.thumbnail_url);
    const label = `${row.media_type} ${row.instagram_media_id} — confirmed: ${row.titles.join(', ')}`;
    if (!image) {
      tally.noPicture++;
      console.log(`· ${label}\n    no picture`);
      continue;
    }
    try {
      const result = await verifier.check(tenant.id, { mappingId: row.id, image, caption: row.caption });
      if (!result) {
        tally.noPicture++;
        console.log(`· ${label}\n    picture couldn't be read`);
        continue;
      }
      inputTokens += result.usage.inputTokens;
      outputTokens += result.usage.outputTokens;
      const found = result.candidates.filter((c) => row.confirmed.includes(c.productId)).length;
      if (found === 0) tally.notCandidate++;
      console.log(`· ${label}\n    ${result.items.length} items, ${result.candidates.length} candidates (${found} confirmed among them)`);
      for (const v of result.verdicts) {
        let mark = '';
        if (v.verdict === 'same') {
          const right = row.confirmed.includes(v.candidate!.productId);
          tally[right ? 'right' : 'wrong']++;
          if (v.confidence >= ASK_AT) tally[right ? 'rightSure' : 'wrongSure']++;
          mark = right ? '✓' : '✗';
        } else {
          tally[v.verdict]++;
        }
        console.log(
          `    ${mark || ' '} ${v.item.what}: ${v.verdict}${v.candidate ? ` «${v.candidate.title}»` : ''} ${v.confidence.toFixed(2)} — ${v.reason}`,
        );
      }
    } catch (err) {
      tally.failed++;
      console.log(`· ${label}\n    failed: ${(err as Error).message}`);
    }
  }

  const same = tally.right + tally.wrong;
  const sure = tally.rightSure + tally.wrongSure;
  const pct = (a: number, b: number) => (b === 0 ? '—' : `${Math.round((a / b) * 100)} %`);
  console.log(`
«same»: ${same} — right ${tally.right}, wrong ${tally.wrong} (precision ${pct(tally.right, same)})
«same» at ≥ ${ASK_AT} (asks the owner): ${sure} — right ${tally.rightSure}, wrong ${tally.wrongSure} (precision ${pct(tally.rightSure, sure)})
unsure ${tally.unsure}, none ${tally.none}
the confirmed product wasn't among the candidates (search missed it): ${tally.notCandidate}
no picture ${tally.noPicture}, failed ${tally.failed}
tokens: ${inputTokens} in, ${outputTokens} out${rows.length ? ` (${Math.round(inputTokens / rows.length)} in per piece of content)` : ''}`);

  await app.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
