/**
 * Run the v2 agent on a few customer messages against a local store and print
 * what it did: tool calls, reply, guard results, staged effects, handoff.
 *
 * A development harness until the turn runner and simulator v2 land (Phase 3).
 * Nothing is sent and no effect is carried out. The only writes are the order
 * draft for a throwaway conversation id, deleted at the end unless --keep.
 *
 * Usage (live model calls, a few cents per run):
 *   cd apps/api && npm run agent:try -- --tenant demo-altamen \
 *     --message "Хочу сорочку з льону" --message "182, 80 кг" --message "чорну"
 *   ... --model gpt-5.4        try another model for this run
 *   ... --keep                 keep the order draft afterwards
 */

import 'reflect-metadata';
import { randomUUID } from 'crypto';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { DataSource } from 'typeorm';
import configuration from '../config/configuration';
import { DatabaseModule } from '../database/database.module';
import { AgentModule } from '../modules/agent/agent.module';
import { AgentService } from '../modules/agent/agent.service';
import { CatalogModule } from '../modules/catalog/catalog.module';
import { TenantsModule } from '../modules/tenants/tenants.module';
import { SettingsModule } from '../modules/settings/settings.module';
import type { AgentHistoryEntry, AgentTurnResult } from '../modules/agent/agent.types';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
    DatabaseModule,
    CatalogModule,
    TenantsModule,
    SettingsModule,
    AgentModule,
  ],
})
class AgentTryModule {}

function args(flag: string): string[] {
  const values: string[] = [];
  process.argv.forEach((a, i) => {
    if (a === flag && process.argv[i + 1]) values.push(process.argv[i + 1]);
  });
  return values;
}

function print(result: AgentTurnResult): void {
  for (const step of result.steps) {
    for (const call of step.toolCalls) {
      console.log(`  [${step.attempt}] → ${call.toolName}(${JSON.stringify(call.input)})`);
    }
    for (const r of step.toolResults) {
      const out = JSON.stringify(r.output);
      console.log(`      ← ${out.length > 220 ? `${out.slice(0, 220)}…` : out}`);
    }
  }
  result.attempts.forEach((a, i) => {
    if (a.grounding.length || a.style.length) {
      console.log(`  ⚠ attempt ${i + 1} failed guards: ${JSON.stringify({ grounding: a.grounding, style: a.style })}`);
    }
  });
  console.log(`  bot: ${result.reply ?? '(no text)'}`);
  for (const e of result.effects) console.log(`  effect: ${JSON.stringify(e)}`);
  if (result.handoff) console.log(`  HANDOFF: ${JSON.stringify(result.handoff)}`);
  if (result.error) console.log(`  error: ${result.error}`);
  const u = result.usage;
  console.log(
    `  (${result.model}, ${result.durationMs}ms, tokens in ${u.inputTokens} / cached ${u.cachedInputTokens} / out ${u.outputTokens})`,
  );
}

async function main() {
  const [slug] = args('--tenant');
  const messages = args('--message');
  const [model] = args('--model');
  if (!slug || messages.length === 0) {
    throw new Error('Usage: npm run agent:try -- --tenant <slug> --message "..." [--message "..."]');
  }

  const app = await NestFactory.createApplicationContext(AgentTryModule, { logger: ['error', 'warn'] });
  const ds = app.get(DataSource);
  const agent = app.get(AgentService);
  const conversationId = randomUUID();

  try {
    const [tenant]: Array<{ id: string }> = await ds.query(`SELECT id FROM tenants WHERE slug = $1`, [slug]);
    if (!tenant) throw new Error(`No tenant with slug ${slug}`);

    const history: AgentHistoryEntry[] = [];
    for (const [i, message] of messages.entries()) {
      console.log(`\ncustomer: ${message}`);
      history.push({ role: 'customer', text: message });
      const result = await agent.runTurn({
        tenantId: tenant.id,
        conversationId,
        customerId: randomUUID(),
        history,
        notes: i === 0 ? ['This is the first reply in the conversation; a welcome line is added before it, so do not greet.'] : [],
        modelOverride: model,
      });
      print(result);
      if (result.reply) history.push({ role: 'bot', text: result.reply });
      if (result.handoff) break;
    }
  } finally {
    if (!process.argv.includes('--keep')) {
      await ds.query(`DELETE FROM checkout_sessions WHERE conversation_id = $1`, [conversationId]);
    } else {
      console.log(`\nkept order draft for conversation ${conversationId}`);
    }
    await app.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
