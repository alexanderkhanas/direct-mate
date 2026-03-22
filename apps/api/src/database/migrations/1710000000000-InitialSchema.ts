import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialSchema1710000000000 implements MigrationInterface {
  name = 'InitialSchema1710000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "tenants" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "name" text NOT NULL,
        "slug" text NOT NULL,
        "business_type" text NOT NULL,
        "timezone" text NOT NULL DEFAULT 'Europe/Kyiv',
        "is_active" boolean NOT NULL DEFAULT true,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_tenants" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_tenants_slug" UNIQUE ("slug")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "users" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "email" text NOT NULL,
        "password_hash" text NOT NULL,
        "role" text NOT NULL,
        "is_active" boolean NOT NULL DEFAULT true,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_users" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_users_tenant_email" UNIQUE ("tenant_id", "email"),
        CONSTRAINT "FK_users_tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "tenant_settings" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "brand_tone_prompt" text,
        "supported_languages" jsonb NOT NULL DEFAULT '[]',
        "business_hours" jsonb,
        "handoff_rules" jsonb,
        "ai_settings" jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_tenant_settings" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_tenant_settings_tenant" UNIQUE ("tenant_id"),
        CONSTRAINT "FK_tenant_settings_tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "connections" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "type" text NOT NULL,
        "status" text NOT NULL DEFAULT 'pending',
        "external_account_id" text,
        "access_token_encrypted" text,
        "refresh_token_encrypted" text,
        "metadata" jsonb,
        "last_sync_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_connections" PRIMARY KEY ("id"),
        CONSTRAINT "FK_connections_tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "sync_jobs" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "connection_id" uuid,
        "sync_type" text NOT NULL,
        "mode" text NOT NULL,
        "status" text NOT NULL DEFAULT 'queued',
        "started_at" timestamptz,
        "finished_at" timestamptz,
        "summary" jsonb,
        "error_message" text,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_sync_jobs" PRIMARY KEY ("id"),
        CONSTRAINT "FK_sync_jobs_tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "customers" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "channel" text NOT NULL DEFAULT 'instagram',
        "external_user_id" text NOT NULL,
        "username" text,
        "full_name" text,
        "phone" text,
        "metadata" jsonb,
        "last_seen_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_customers" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_customers_tenant_channel_user" UNIQUE ("tenant_id", "channel", "external_user_id"),
        CONSTRAINT "FK_customers_tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_customers_tenant_id" ON "customers" ("tenant_id");
      CREATE INDEX "IDX_customers_last_seen_at" ON "customers" ("last_seen_at");
    `);

    await queryRunner.query(`
      CREATE TABLE "conversations" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "customer_id" uuid NOT NULL,
        "channel" text NOT NULL DEFAULT 'instagram',
        "channel_account_id" text,
        "status" text NOT NULL DEFAULT 'active',
        "needs_handoff" boolean NOT NULL DEFAULT false,
        "handoff_reason" text,
        "last_message_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_conversations" PRIMARY KEY ("id"),
        CONSTRAINT "FK_conversations_tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_conversations_customer" FOREIGN KEY ("customer_id") REFERENCES "customers"("id")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_conversations_tenant_id" ON "conversations" ("tenant_id");
      CREATE INDEX "IDX_conversations_customer_id" ON "conversations" ("customer_id");
      CREATE INDEX "IDX_conversations_status" ON "conversations" ("status");
      CREATE INDEX "IDX_conversations_last_message_at" ON "conversations" ("last_message_at" DESC);
    `);

    await queryRunner.query(`
      CREATE TABLE "conversation_state" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "conversation_id" uuid NOT NULL,
        "state_status" text NOT NULL DEFAULT 'browsing',
        "selected_product_id" uuid,
        "selected_variant_id" uuid,
        "active_checkout_session_id" uuid,
        "last_ai_confidence" numeric(4,3),
        "context_json" jsonb,
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_conversation_state" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_conversation_state_conversation" UNIQUE ("conversation_id"),
        CONSTRAINT "FK_conversation_state_conversation" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "messages" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "conversation_id" uuid NOT NULL,
        "tenant_id" uuid NOT NULL,
        "direction" text NOT NULL,
        "role" text NOT NULL,
        "external_message_id" text,
        "text" text,
        "raw_payload" jsonb,
        "tool_calls" jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_messages" PRIMARY KEY ("id"),
        CONSTRAINT "FK_messages_conversation" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_messages_conversation_id" ON "messages" ("conversation_id");
      CREATE INDEX "IDX_messages_external_message_id" ON "messages" ("external_message_id");
      CREATE INDEX "IDX_messages_created_at" ON "messages" ("created_at");
    `);

    await queryRunner.query(`
      CREATE TABLE "products" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "external_product_id" text,
        "title" text NOT NULL,
        "description" text,
        "category" text,
        "brand" text,
        "status" text NOT NULL DEFAULT 'active',
        "metadata" jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_products" PRIMARY KEY ("id"),
        CONSTRAINT "FK_products_tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_products_tenant_id" ON "products" ("tenant_id");
      CREATE INDEX "IDX_products_external_product_id" ON "products" ("external_product_id");
    `);

    await queryRunner.query(`
      CREATE EXTENSION IF NOT EXISTS pg_trgm;
      CREATE INDEX "IDX_products_title_trgm" ON "products" USING gin ("title" gin_trgm_ops);
    `);

    await queryRunner.query(`
      CREATE TABLE "product_variants" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "product_id" uuid NOT NULL,
        "external_variant_id" text,
        "sku" text,
        "color" text,
        "size" text,
        "price" numeric(10,2) NOT NULL,
        "currency" text NOT NULL DEFAULT 'UAH',
        "active" boolean NOT NULL DEFAULT true,
        "metadata" jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_product_variants" PRIMARY KEY ("id"),
        CONSTRAINT "FK_product_variants_product" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_product_variants_product_id" ON "product_variants" ("product_id");
      CREATE INDEX "IDX_product_variants_color" ON "product_variants" ("color");
      CREATE INDEX "IDX_product_variants_size" ON "product_variants" ("size");
    `);

    await queryRunner.query(`
      CREATE TABLE "stock_balances" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "variant_id" uuid NOT NULL,
        "warehouse_code" text,
        "available_qty" integer NOT NULL DEFAULT 0,
        "reserved_qty" integer NOT NULL DEFAULT 0,
        "pending_checkout_qty" integer NOT NULL DEFAULT 0,
        "last_synced_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_stock_balances" PRIMARY KEY ("id"),
        CONSTRAINT "FK_stock_balances_variant" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_stock_balances_variant_id" ON "stock_balances" ("variant_id");
      CREATE INDEX "IDX_stock_balances_last_synced_at" ON "stock_balances" ("last_synced_at");
    `);

    await queryRunner.query(`
      CREATE TABLE "product_media" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "product_id" uuid NOT NULL,
        "url" text NOT NULL,
        "color" text,
        "sort_order" integer NOT NULL DEFAULT 0,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_product_media" PRIMARY KEY ("id"),
        CONSTRAINT "FK_product_media_product" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "reservations" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "conversation_id" uuid NOT NULL,
        "customer_id" uuid NOT NULL,
        "variant_id" uuid NOT NULL,
        "qty" integer NOT NULL DEFAULT 1,
        "status" text NOT NULL DEFAULT 'active',
        "expires_at" timestamptz NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_reservations" PRIMARY KEY ("id"),
        CONSTRAINT "FK_reservations_tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_reservations_variant_id" ON "reservations" ("variant_id");
      CREATE INDEX "IDX_reservations_status" ON "reservations" ("status");
      CREATE INDEX "IDX_reservations_expires_at" ON "reservations" ("expires_at");
    `);

    await queryRunner.query(`
      CREATE TABLE "checkout_sessions" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "conversation_id" uuid NOT NULL,
        "customer_id" uuid NOT NULL,
        "status" text NOT NULL DEFAULT 'collecting_customer_info',
        "reservation_id" uuid,
        "expires_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_checkout_sessions" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "checkout_items" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "checkout_session_id" uuid NOT NULL,
        "product_id" uuid NOT NULL,
        "variant_id" uuid NOT NULL,
        "qty" integer NOT NULL DEFAULT 1,
        "unit_price" numeric(10,2) NOT NULL,
        "currency" text NOT NULL DEFAULT 'UAH',
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_checkout_items" PRIMARY KEY ("id"),
        CONSTRAINT "FK_checkout_items_session" FOREIGN KEY ("checkout_session_id") REFERENCES "checkout_sessions"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "checkout_customer_info" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "checkout_session_id" uuid NOT NULL,
        "full_name" text,
        "phone" text,
        "city" text,
        "delivery_provider" text,
        "branch" text,
        "payment_method" text,
        "comment" text,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_checkout_customer_info" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_checkout_customer_info_session" UNIQUE ("checkout_session_id"),
        CONSTRAINT "FK_checkout_customer_info_session" FOREIGN KEY ("checkout_session_id") REFERENCES "checkout_sessions"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "orders" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "checkout_session_id" uuid,
        "customer_id" uuid NOT NULL,
        "external_order_id" text,
        "status" text NOT NULL DEFAULT 'draft',
        "total_amount" numeric(10,2),
        "currency" text NOT NULL DEFAULT 'UAH',
        "source" text NOT NULL DEFAULT 'instagram_ai',
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_orders" PRIMARY KEY ("id"),
        CONSTRAINT "FK_orders_tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "order_items" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "order_id" uuid NOT NULL,
        "product_id" uuid NOT NULL,
        "variant_id" uuid NOT NULL,
        "qty" integer NOT NULL DEFAULT 1,
        "unit_price" numeric(10,2) NOT NULL,
        "currency" text NOT NULL DEFAULT 'UAH',
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_order_items" PRIMARY KEY ("id"),
        CONSTRAINT "FK_order_items_order" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "manager_examples" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "scenario" text,
        "customer_message" text NOT NULL,
        "manager_reply" text NOT NULL,
        "tags" text[] NOT NULL DEFAULT '{}',
        "is_active" boolean NOT NULL DEFAULT true,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_manager_examples" PRIMARY KEY ("id"),
        CONSTRAINT "FK_manager_examples_tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "audit_logs" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "conversation_id" uuid,
        "type" text NOT NULL,
        "status" text NOT NULL DEFAULT 'success',
        "details" jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_audit_logs" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_audit_logs_tenant_id" ON "audit_logs" ("tenant_id");
      CREATE INDEX "IDX_audit_logs_conversation_id" ON "audit_logs" ("conversation_id");
      CREATE INDEX "IDX_audit_logs_type" ON "audit_logs" ("type");
      CREATE INDEX "IDX_audit_logs_created_at" ON "audit_logs" ("created_at" DESC);
    `);

    await queryRunner.query(`
      CREATE TABLE "integration_events" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "connection_id" uuid,
        "event_type" text NOT NULL,
        "external_event_id" text,
        "payload" jsonb,
        "processed" boolean NOT NULL DEFAULT false,
        "processed_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_integration_events" PRIMARY KEY ("id")
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const tables = [
      'integration_events', 'audit_logs', 'manager_examples',
      'order_items', 'orders', 'checkout_customer_info', 'checkout_items',
      'checkout_sessions', 'reservations', 'product_media', 'stock_balances',
      'product_variants', 'products', 'messages', 'conversation_state',
      'conversations', 'customers', 'sync_jobs', 'connections',
      'tenant_settings', 'users', 'tenants',
    ];
    for (const table of tables) {
      await queryRunner.query(`DROP TABLE IF EXISTS "${table}" CASCADE`);
    }
  }
}
