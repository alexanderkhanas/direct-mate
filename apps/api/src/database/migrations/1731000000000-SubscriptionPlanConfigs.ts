import { MigrationInterface, QueryRunner } from 'typeorm';

export class SubscriptionPlanConfigs1731000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE subscription_plan_configs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        plan_type TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        price INTEGER NOT NULL,
        currency INTEGER NOT NULL DEFAULT 980,
        conversation_limit INTEGER,
        ig_accounts_limit INTEGER NOT NULL DEFAULT 1,
        products_limit INTEGER,
        connections_limit INTEGER NOT NULL DEFAULT 1,
        team_members_limit INTEGER NOT NULL DEFAULT 1,
        history_days INTEGER NOT NULL DEFAULT 30,
        is_active BOOLEAN NOT NULL DEFAULT true,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      INSERT INTO subscription_plan_configs (plan_type, display_name, price, conversation_limit, ig_accounts_limit, products_limit, connections_limit, team_members_limit, history_days, sort_order)
      VALUES
        ('starter',      'Starter',      409900,  1000, 1,  500,  1, 1,  30, 1),
        ('professional', 'Professional', 819900,  3000, 3,  2000, 2, 3,  90, 2),
        ('business',     'Business',     1639900, NULL, 10, NULL, 99, 5, 365, 3);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS subscription_plan_configs;`);
  }
}
