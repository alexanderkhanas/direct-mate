import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddConversationTraces1779000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE conversation_traces (
        id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        trace_id             UUID NOT NULL,
        tenant_id            UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        conversation_id      UUID REFERENCES conversations(id) ON DELETE CASCADE,
        customer_id          UUID REFERENCES customers(id) ON DELETE SET NULL,
        inbound_message_text TEXT,
        inbound_media_ref    JSONB,
        started_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
        completed_at         TIMESTAMPTZ,
        duration_ms          INTEGER,
        decision             TEXT NOT NULL,
        template_scenario    TEXT,
        handoff_reason       TEXT,
        trace_steps          JSONB NOT NULL DEFAULT '[]'::jsonb,
        stage_timings        JSONB NOT NULL DEFAULT '{}'::jsonb,
        classifier_output    JSONB,
        openai_request_ids   TEXT[],
        error                JSONB,
        created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE INDEX idx_conv_traces_tenant_started   ON conversation_traces (tenant_id, started_at DESC);
      CREATE INDEX idx_conv_traces_conversation     ON conversation_traces (conversation_id, started_at DESC);
      CREATE INDEX idx_conv_traces_trace_id         ON conversation_traces (trace_id);
      CREATE INDEX idx_conv_traces_errors           ON conversation_traces (tenant_id, started_at DESC) WHERE decision = 'error';
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS conversation_traces;`);
  }
}
