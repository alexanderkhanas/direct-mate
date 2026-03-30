import 'reflect-metadata';
import { AppDataSource } from './data-source';
import * as bcrypt from 'bcrypt';

async function seed() {
  await AppDataSource.initialize();

  // Create tenant
  const result = await AppDataSource.query(
    `SELECT id FROM tenants WHERE slug = $1 LIMIT 1`,
    ['pilot'],
  );
  let tenantId: string;

  if (result.length === 0) {
    const inserted = await AppDataSource.query(
      `INSERT INTO tenants (name, slug, business_type, timezone, is_active)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      ['Pilot Store', 'pilot', 'fashion', 'Europe/Kyiv', true],
    );
    tenantId = inserted[0].id;
    console.log(`✓ Tenant created: ${tenantId}`);
  } else {
    tenantId = result[0].id;
    console.log(`- Tenant already exists: ${tenantId}`);
  }

  // Create admin user
  const email = 'admin@directmate.app';
  const userResult = await AppDataSource.query(
    `SELECT id FROM users WHERE email = $1 LIMIT 1`,
    [email],
  );

  if (userResult.length === 0) {
    const passwordHash = await bcrypt.hash('admin123', 10);
    await AppDataSource.query(
      `INSERT INTO users (tenant_id, email, password_hash, role, is_active)
       VALUES ($1, $2, $3, $4, $5)`,
      [tenantId, email, passwordHash, 'owner', true],
    );
    console.log(`✓ User created: ${email} / admin123`);
  } else {
    console.log(`- User already exists: ${email}`);
  }

  // Create default settings
  const settingsResult = await AppDataSource.query(
    `SELECT id FROM tenant_settings WHERE tenant_id = $1 LIMIT 1`,
    [tenantId],
  );

  if (settingsResult.length === 0) {
    await AppDataSource.query(
      `INSERT INTO tenant_settings (tenant_id, brand_tone_prompt, supported_languages, handoff_rules)
       VALUES ($1, $2, $3, $4)`,
      [
        tenantId,
        'Warm, concise, manager-like. Never guess facts about stock or price.',
        JSON.stringify(['uk', 'en']),
        JSON.stringify({ maxFailedTurns: 2, stockFreshnessMinutes: 10, negativeSentimentEscalation: true }),
      ],
    );
    console.log(`✓ Settings created`);
  } else {
    console.log(`- Settings already exist`);
  }

  // ─── System tenant + superadmin user ─────────────────────────
  const systemTenantId = '00000000-0000-0000-0000-000000000000';

  const systemTenantResult = await AppDataSource.query(
    `SELECT id FROM tenants WHERE id = $1 LIMIT 1`,
    [systemTenantId],
  );

  if (systemTenantResult.length === 0) {
    await AppDataSource.query(
      `INSERT INTO tenants (id, name, slug, business_type, timezone, is_active)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [systemTenantId, 'System', 'system', 'fashion', 'Europe/Kyiv', true],
    );
    console.log(`✓ System tenant created: ${systemTenantId}`);
  } else {
    console.log(`- System tenant already exists: ${systemTenantId}`);
  }

  const superadminEmail = 'superadmin@directmate.app';
  const superadminResult = await AppDataSource.query(
    `SELECT id FROM users WHERE email = $1 LIMIT 1`,
    [superadminEmail],
  );

  if (superadminResult.length === 0) {
    const superadminHash = await bcrypt.hash('admin123', 10);
    await AppDataSource.query(
      `INSERT INTO users (tenant_id, email, password_hash, role, is_active)
       VALUES ($1, $2, $3, $4, $5)`,
      [systemTenantId, superadminEmail, superadminHash, 'superadmin', true],
    );
    console.log(`✓ Superadmin user created: ${superadminEmail} / admin123`);
  } else {
    console.log(`- Superadmin user already exists: ${superadminEmail}`);
  }

  await AppDataSource.destroy();
  console.log('\nDone.');
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
