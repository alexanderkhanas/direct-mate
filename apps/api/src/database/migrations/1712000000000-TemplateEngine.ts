import { MigrationInterface, QueryRunner } from 'typeorm';

export class TemplateEngine1712000000000 implements MigrationInterface {
  name = 'TemplateEngine1712000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── store_configs ─────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE "store_configs" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "brand_config" jsonb NOT NULL DEFAULT '{}',
        "flow_config" jsonb NOT NULL DEFAULT '{}',
        "checkout_config" jsonb NOT NULL DEFAULT '{}',
        "escalation_config" jsonb NOT NULL DEFAULT '{}',
        "recommendation_config" jsonb NOT NULL DEFAULT '{}',
        "handoff_config" jsonb NOT NULL DEFAULT '{}',
        "fallback_config" jsonb NOT NULL DEFAULT '{}',
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_store_configs" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_store_configs_tenant" UNIQUE ("tenant_id"),
        CONSTRAINT "FK_store_configs_tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE
      )
    `);

    // ── response_templates ────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE "response_templates" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "scenario" text NOT NULL,
        "stage" text,
        "blocks" jsonb NOT NULL,
        "required_variables" jsonb DEFAULT '[]',
        "tone_tags" jsonb DEFAULT '[]',
        "priority" integer NOT NULL DEFAULT 50,
        "active" boolean NOT NULL DEFAULT true,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_response_templates" PRIMARY KEY ("id"),
        CONSTRAINT "FK_response_templates_tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE
      )
    `);

    // ── phrase_blocks ─────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE "phrase_blocks" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "type" text NOT NULL,
        "text" text NOT NULL,
        "scenario_tags" jsonb DEFAULT '[]',
        "active" boolean NOT NULL DEFAULT true,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_phrase_blocks" PRIMARY KEY ("id"),
        CONSTRAINT "FK_phrase_blocks_tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE
      )
    `);

    // ── faq_items ─────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE "faq_items" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "question_tags" jsonb NOT NULL,
        "answer_template" text NOT NULL,
        "active" boolean NOT NULL DEFAULT true,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_faq_items" PRIMARY KEY ("id"),
        CONSTRAINT "FK_faq_items_tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE
      )
    `);

    // ── Indexes ───────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE INDEX "IDX_response_templates_tenant_scenario" ON "response_templates" ("tenant_id", "scenario");
      CREATE INDEX "IDX_response_templates_tenant_stage" ON "response_templates" ("tenant_id", "stage");
      CREATE INDEX "IDX_phrase_blocks_tenant_type" ON "phrase_blocks" ("tenant_id", "type");
      CREATE INDEX "IDX_faq_items_tenant" ON "faq_items" ("tenant_id");
    `);

    // ── Seed default beauty-store templates for every existing tenant ──
    await queryRunner.query(`
      INSERT INTO "store_configs" ("tenant_id", "brand_config", "flow_config", "checkout_config", "escalation_config", "recommendation_config", "handoff_config", "fallback_config")
      SELECT
        t."id",
        '{"language":"uk","address_style":"ви","formality":"friendly_polite","emoji_policy":{"enabled":true,"preferred":["💛"],"max_per_message":2},"message_length":"short_to_medium","cta_style":"soft"}'::jsonb,
        '{"enabled_stages":["greeting","need_discovery","product_discovery","showing_options","selection_help","product_selected","checkout_started","collecting_customer_info","order_confirmation","handoff_to_manager"]}'::jsonb,
        '{"fields":[{"key":"full_name","label":"ПІБ","required":true},{"key":"phone","label":"Телефон","required":true},{"key":"city","label":"Місто","required":true},{"key":"branch","label":"Відділення Нової Пошти","required":true}],"collection_style":"single_message","confirmation_enabled":true}'::jsonb,
        '{"always_escalate_intents":["complaint","support_issue","request_human"],"low_confidence_threshold":0.7,"escalate_on_negative_sentiment":true}'::jsonb,
        '{"mode":"single_best_match","max_recommendations":1,"include_reason":true}'::jsonb,
        '{"enabled":true,"pause_bot_after_handoff":true,"send_internal_summary":true}'::jsonb,
        '{"mode":"template_first_with_safe_fallback","max_fallback_attempts_per_thread":2}'::jsonb
      FROM "tenants" t
      WHERE NOT EXISTS (SELECT 1 FROM "store_configs" sc WHERE sc."tenant_id" = t."id")
    `);

    // ── Seed default response templates ────────────────────────────
    // We insert for every tenant that got a store_config
    await queryRunner.query(`
      INSERT INTO "response_templates" ("tenant_id", "scenario", "stage", "blocks", "required_variables", "tone_tags", "priority")
      SELECT sc."tenant_id", v."scenario", v."stage", v."blocks"::jsonb, v."required_variables"::jsonb, v."tone_tags"::jsonb, v."priority"
      FROM "store_configs" sc
      CROSS JOIN (VALUES
        ('greeting', 'greeting', '["Вітаю 💛 Чим можу допомогти?"]', '[]', '["warm","short"]', 90),
        ('greeting', 'greeting', '["Доброго дня! Що вас цікавить?"]', '[]', '["warm","short"]', 80),
        ('show_products', 'showing_options', '["Зараз є такі варіанти {category}:\\n{product_list}\\n\\nМожу підказати, який краще підійде 💛"]', '["category","product_list"]', '["warm"]', 90),
        ('show_price', 'product_selected', '["Ціна на {product_name} — {price} 💛"]', '["product_name","price"]', '["warm","short"]', 90),
        ('show_price', 'product_selected', '["{product_name} коштує {price}. Оформлюємо? 💛"]', '["product_name","price"]', '["warm","short"]', 80),
        ('recommend_product', 'selection_help', '["Я б радила {product_name} — {reason}. Ціна {price}. Хочете оформити? 💛"]', '["product_name","reason","price"]', '["warm"]', 90),
        ('collect_checkout_info', 'checkout_started', '["Чудово 💛 Для оформлення напишіть, будь ласка:\\n• ПІБ\\n• Номер телефону\\n• Місто та відділення Нової Пошти"]', '[]', '["warm"]', 90),
        ('confirm_order', 'order_confirmation', '["Дякую 💛 Ваше замовлення оформлено:\\n{order_summary}\\n\\nОчікуйте повідомлення про відправку!"]', '["order_summary"]', '["warm"]', 90),
        ('answer_delivery', NULL, '["Відправка здійснюється Новою Поштою. Зазвичай 1-3 дні після оформлення 💛"]', '[]', '["warm"]', 90),
        ('answer_payment', NULL, '["Ми пропонуємо 2 варіанти оплати:\\n• повна передоплата\\n• передоплата 100 грн + накладений платіж"]', '[]', '["warm"]', 90),
        ('out_of_stock', NULL, '["На жаль, {product_name} зараз немає в наявності. Можу підказати схожі варіанти або повідомити, коли з''явиться 💛"]', '["product_name"]', '["warm"]', 90),
        ('ask_recommendation_from_shown', 'showing_options', '["З цих варіантів я б радила {product_name} — {reason} 💛"]', '["product_name","reason"]', '["warm"]', 90),
        ('confirm_selection', 'product_selected', '["Оформлюємо {product_name}? 💛"]', '["product_name"]', '["warm","short"]', 90),
        ('order_confirmed_ask_delivery', 'collecting_customer_info', '["Чудово 💛 Для оформлення напишіть:\\n• ПІБ\\n• Телефон\\n• Місто та відділення НП"]', '[]', '["warm"]', 90)
      ) AS v("scenario", "stage", "blocks", "required_variables", "tone_tags", "priority")
    `);

    // ── Seed default phrase blocks ─────────────────────────────────
    await queryRunner.query(`
      INSERT INTO "phrase_blocks" ("tenant_id", "type", "text", "scenario_tags")
      SELECT sc."tenant_id", v."type", v."text", v."scenario_tags"::jsonb
      FROM "store_configs" sc
      CROSS JOIN (VALUES
        ('opener', 'Вітаю 💛', '["greeting"]'),
        ('opener', 'Доброго дня!', '["greeting"]'),
        ('cta', 'Якщо хочете, можу одразу допомогти з оформленням 💛', '["show_price","recommend_product"]'),
        ('cta', 'Оформлюємо? 💛', '["product_selected","confirm_selection"]'),
        ('reassurance', 'Зазвичай відправляємо в той же день 💛', '["checkout_started","confirm_order"]'),
        ('recommendation', 'Я б радила цей варіант — ', '["recommend_product","ask_recommendation_from_shown"]'),
        ('escalation', 'Зараз передам ваше питання менеджеру 💛', '["complaint","request_human"]'),
        ('closing', 'Дякую за замовлення! Гарного дня 💛', '["confirm_order"]')
      ) AS v("type", "text", "scenario_tags")
    `);

    // ── Seed default FAQ items ─────────────────────────────────────
    await queryRunner.query(`
      INSERT INTO "faq_items" ("tenant_id", "question_tags", "answer_template")
      SELECT sc."tenant_id", v."question_tags"::jsonb, v."answer_template"
      FROM "store_configs" sc
      CROSS JOIN (VALUES
        ('["delivery","shipping","доставка","відправка"]', 'Відправка здійснюється Новою Поштою. Зазвичай 1-3 дні після оформлення 💛'),
        ('["payment","оплата","як оплатити"]', 'Ми пропонуємо 2 варіанти оплати:\n• повна передоплата\n• передоплата 100 грн + накладений платіж'),
        ('["return","повернення","обмін"]', 'Повернення та обмін протягом 14 днів з моменту отримання. Товар має бути в оригінальній упаковці 💛')
      ) AS v("question_tags", "answer_template")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const tables = ['faq_items', 'phrase_blocks', 'response_templates', 'store_configs'];
    for (const table of tables) {
      await queryRunner.query(`DROP TABLE IF EXISTS "${table}" CASCADE`);
    }
  }
}
