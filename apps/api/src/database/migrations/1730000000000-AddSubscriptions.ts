import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSubscriptions1730000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE subscription_plans (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        plan_type TEXT NOT NULL DEFAULT 'trial',
        status TEXT NOT NULL DEFAULT 'active',
        trial_ends_at TIMESTAMPTZ,
        current_period_start TIMESTAMPTZ,
        current_period_end TIMESTAMPTZ,
        mono_subscription_id TEXT,
        amount INTEGER,
        currency INTEGER DEFAULT 980,
        conversation_limit INTEGER,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT uq_subscription_tenant UNIQUE(tenant_id)
      );

      CREATE TABLE subscription_usage (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        period_start DATE NOT NULL,
        period_end DATE NOT NULL,
        conversation_count INTEGER NOT NULL DEFAULT 0,
        CONSTRAINT uq_usage_tenant_period UNIQUE(tenant_id, period_start)
      );

      CREATE INDEX idx_subscription_plans_tenant ON subscription_plans(tenant_id);
      CREATE INDEX idx_subscription_plans_status ON subscription_plans(status);
      CREATE INDEX idx_subscription_usage_tenant ON subscription_usage(tenant_id);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP TABLE IF EXISTS subscription_usage;
      DROP TABLE IF EXISTS subscription_plans;
    `);
  }
}
