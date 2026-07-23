#!/usr/bin/env ts-node
/**
 * Deterministic reproduction + verification for the conversation-history
 * ordering bug (prod conv 3c685eaa).
 *
 * The classifier was fed `recentMessages` in UNDEFINED order because
 * `findById` loaded the `messages` relation with no ORDER BY and callers did
 * `.messages.slice(-10)`. A Postgres UPDATE relocates a row's physical tuple,
 * so on a churned table heap order diverges from chronological order — and
 * `slice(-10)` then returns the wrong ten rows, scrambled.
 *
 * This script proves it end-to-end, on the REAL database, no LLM:
 *   1. insert N messages at known increasing timestamps
 *   2. UPDATE a few (relocates their tuples → scrambles heap order)
 *   3. compare three reads:
 *        A. raw relation load with NO order  → the OLD behaviour (scrambled)
 *        B. findById (now ORDER BY createdAt) → chronological
 *        C. getRecentMessages(limit)          → chronological, last N
 *
 * A shows the bug still reproduces at the data layer; B and C show the fix.
 * Exits non-zero if B or C are out of order.
 *
 * Usage: ts-node src/scripts/verify-message-ordering.ts
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { AppModule } from '../app.module';
import { ConversationsService } from '../modules/conversations/conversations.service';
import { Conversation } from '../modules/conversations/entities/conversation.entity';
import { Message } from '../modules/conversations/entities/message.entity';
import { MessageDirection, MessageRole } from '@direct-mate/shared';

const TENANT_MARKER = 'ordering-verify';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error'],
  });
  const ds = app.get(DataSource);
  const convSvc = app.get(ConversationsService);
  const convRepo = ds.getRepository(Conversation);
  const msgRepo = ds.getRepository(Message);

  // A throwaway tenant/customer/conversation. Any tenant works; grab one.
  const anyTenant: Array<{ id: string }> = await ds.query(
    `SELECT id FROM tenants ORDER BY created_at LIMIT 1`,
  );
  if (!anyTenant[0]) throw new Error('no tenant in DB to attach the test conversation to');
  const tenantId = anyTenant[0].id;

  const customer = await convSvc.findOrCreateCustomer(
    tenantId,
    'ordering_verify_channel',
    `ordering_verify_${Date.now()}`,
  );
  const conv = convRepo.create({
    tenantId,
    customerId: customer.id,
    channel: 'ordering_verify_channel',
    channelAccountId: TENANT_MARKER,
    status: 'active' as any,
  });
  await convRepo.save(conv);

  // 16 messages, alternating roles, strictly increasing timestamps.
  const base = new Date('2026-07-22T18:00:00.000Z').getTime();
  const texts: string[] = [];
  for (let i = 0; i < 16; i++) {
    const role = i % 2 === 0 ? MessageRole.User : MessageRole.Assistant;
    const text = `turn-${String(i).padStart(2, '0')}`;
    texts.push(text);
    const m = msgRepo.create({
      conversationId: conv.id,
      tenantId,
      direction: i % 2 === 0 ? MessageDirection.Inbound : MessageDirection.Outbound,
      role,
      text,
      createdAt: new Date(base + i * 1000),
    });
    await msgRepo.save(m);
  }

  // Scramble heap order the way prod churn does: an UPDATE rewrites the tuple
  // at the end of the heap. Update every 3rd message; keep created_at intact.
  await ds.query(
    `UPDATE messages SET raw_payload = '{"touched":true}'::jsonb
      WHERE conversation_id = $1
        AND text IN ('turn-00','turn-03','turn-06','turn-09','turn-12','turn-15')`,
    [conv.id],
  );

  // ── A. OLD behaviour: raw relation load, no order ──────────────
  const rawConv = await convRepo.findOne({
    where: { id: conv.id },
    relations: ['messages'],
  });
  const heapOrder = (rawConv!.messages as Message[]).map((m) => m.text);

  // ── B. findById (now ordered) ──────────────────────────────────
  const fixed = await convSvc.findById(conv.id);
  const findByIdOrder = fixed.messages.map((m) => m.text);

  // ── C. getRecentMessages(10) ───────────────────────────────────
  const recent = await convSvc.getRecentMessages(conv.id, 10);
  const recentOrder = recent.map((m) => m.text);

  const chronological = [...texts];
  const isSorted = (arr: (string | null)[]) =>
    arr.every((v, i) => i === 0 || (v ?? '') >= (arr[i - 1] ?? ''));

  const line = '─'.repeat(72);
  console.log('\n' + line);
  console.log('A. RAW relation load (no ORDER BY) — the OLD production path');
  console.log('   ' + heapOrder.join(' '));
  console.log('   in chronological order? ' + (isSorted(heapOrder) ? 'yes' : 'NO ← bug reproduced'));
  console.log(line);
  console.log('B. findById() — fixed (ORDER BY created_at)');
  console.log('   ' + findByIdOrder.join(' '));
  console.log('   in chronological order? ' + (isSorted(findByIdOrder) ? 'YES' : 'NO'));
  console.log(line);
  console.log('C. getRecentMessages(10) — fixed, last 10');
  console.log('   ' + recentOrder.join(' '));
  const expectedRecent = chronological.slice(-10);
  const recentOk = JSON.stringify(recentOrder) === JSON.stringify(expectedRecent);
  console.log('   equals last-10 chronological? ' + (recentOk ? 'YES' : 'NO'));
  console.log('   expected: ' + expectedRecent.join(' '));
  console.log(line + '\n');

  // Cleanup: drop the throwaway conversation + its messages + customer.
  await msgRepo.delete({ conversationId: conv.id });
  await convRepo.delete({ id: conv.id });
  await ds.query(`DELETE FROM customers WHERE id = $1`, [customer.id]);

  await app.close();

  const bOk = isSorted(findByIdOrder) && findByIdOrder.length === texts.length;
  const cOk = recentOk;
  if (!bOk || !cOk) {
    console.error('FAIL: the fix did not produce chronological order.');
    process.exit(1);
  }
  // Loudly note if A happened to come out sorted — then the scramble didn't
  // take and the test proved nothing about the bug, only about the fix.
  if (isSorted(heapOrder)) {
    console.warn(
      'NOTE: raw heap order came out chronological this run — the UPDATE did ' +
        'not relocate tuples as expected (small/vacuumed table). The fix is ' +
        'still verified (B, C), but A did not demonstrate the bug this run.',
    );
  }
  console.log('PASS: findById and getRecentMessages both return chronological order.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
