import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export interface ConversationTraceError {
  name: string;
  message: string;
  stack?: string;
  /** Best-effort indicator of which pipeline stage threw — usually the
   *  last `ctx.trace.push()` entry before the exception. */
  stage?: string;
}

export interface ConversationTraceStageTimings {
  classify_ms?: number;
  search_ms?: number;
  render_ms?: number;
  send_ms?: number;
  openai_call_count?: number;
  openai_total_tokens?: number;
  [key: string]: number | undefined;
}

export interface OpenAiCallRecord {
  model: string;
  promptTokens: number;
  completionTokens: number;
  latencyMs: number;
  requestId?: string | null;
  /** Which call site emitted this — e.g. 'classifier', 'vision_post_share',
   *  'vision_customer_photo'. Helps cost attribution by purpose. */
  source?: string;
}

@Entity('conversation_traces')
export class ConversationTrace {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  traceId!: string;

  @Index()
  @Column({ type: 'uuid' })
  tenantId!: string;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  conversationId!: string | null;

  @Column({ type: 'uuid', nullable: true })
  customerId!: string | null;

  @Column({ type: 'text', nullable: true })
  inboundMessageText!: string | null;

  @Column({ type: 'jsonb', nullable: true })
  inboundMediaRef!: Record<string, unknown> | null;

  @Column({ type: 'timestamptz' })
  startedAt!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  completedAt!: Date | null;

  @Column({ type: 'int', nullable: true })
  durationMs!: number | null;

  @Column({ type: 'text' })
  decision!: 'reply' | 'handoff' | 'create_draft_order' | 'error';

  @Column({ type: 'text', nullable: true })
  templateScenario!: string | null;

  @Column({ type: 'text', nullable: true })
  handoffReason!: string | null;

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  traceSteps!: string[];

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  stageTimings!: ConversationTraceStageTimings;

  @Column({ type: 'jsonb', nullable: true })
  classifierOutput!: Record<string, unknown> | null;

  @Column({ type: 'text', array: true, nullable: true })
  openaiRequestIds!: string[] | null;

  @Column({ type: 'jsonb', nullable: true })
  error!: ConversationTraceError | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
