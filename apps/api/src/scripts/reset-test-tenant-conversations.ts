// Wipe all conversation data for a single tenant.
//
// Run via: npm run reset:test-tenant:conversations
//
// Override target slug via env var:
//   TEST_TENANT_SLUG (default: test-clothes)
//
// Removes (in FK-safe order): audit_logs, messages, conversation_state,
// conversations, customers — scoped to the target tenant. Catalog,
// templates, store_config, and the tenant row itself are untouched.
//
// Useful between Instagram tester runs to start fresh without re-seeding
// the tenant.

import 'reflect-metadata';
import { AppDataSource } from '../database/data-source';

const SLUG = process.env.TEST_TENANT_SLUG ?? 'test-clothes';

async function reset(): Promise<void> {
  await AppDataSource.initialize();
  try {
    const rows: Array<{ id: string }> = await AppDataSource.query(
      `SELECT id FROM tenants WHERE slug = $1 LIMIT 1`,
      [SLUG],
    );
    if (rows.length === 0) {
      console.error(`✗ Tenant not found: slug="${SLUG}"`);
      process.exit(1);
    }
    const tenantId = rows[0].id;

    const auditLogs = await AppDataSource.query(
      `DELETE FROM audit_logs WHERE conversation_id IN (
         SELECT id FROM conversations WHERE tenant_id = $1
       )`,
      [tenantId],
    );
    const messages = await AppDataSource.query(
      `DELETE FROM messages WHERE conversation_id IN (
         SELECT id FROM conversations WHERE tenant_id = $1
       )`,
      [tenantId],
    );
    const state = await AppDataSource.query(
      `DELETE FROM conversation_state WHERE conversation_id IN (
         SELECT id FROM conversations WHERE tenant_id = $1
       )`,
      [tenantId],
    );
    const conversations = await AppDataSource.query(
      `DELETE FROM conversations WHERE tenant_id = $1`,
      [tenantId],
    );
    const customers = await AppDataSource.query(
      `DELETE FROM customers WHERE tenant_id = $1`,
      [tenantId],
    );

    // TypeORM returns [rows, count] for DELETE; the second element is the
    // affected-row count (or undefined for some drivers — fall back to 0).
    const count = (r: unknown): number =>
      Array.isArray(r) && typeof r[1] === 'number' ? r[1] : 0;

    console.log(`✓ Conversations wiped for tenant "${SLUG}":`);
    console.log(`  audit_logs:         ${count(auditLogs)}`);
    console.log(`  messages:           ${count(messages)}`);
    console.log(`  conversation_state: ${count(state)}`);
    console.log(`  conversations:      ${count(conversations)}`);
    console.log(`  customers:          ${count(customers)}`);
  } finally {
    await AppDataSource.destroy();
  }
}

reset().catch((err) => {
  console.error(err);
  process.exit(1);
});
