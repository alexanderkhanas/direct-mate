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

/**
 * Where the turn came from. Every caller of `ReplyEngineService.process()`
 * sets this, so a trace can never be mistaken for one produced by a different
 * environment.
 *
 * This exists because it bit us: the Live DM console's media toggle stayed
 * armed after each send, so it attached a story reference to EVERY message.
 * Real Instagram sets `reply_to.story` only on the one message that replies to
 * a story (`instagram.service.ts` extractMediaReference), so the resulting
 * traces looked like a production Instagram bug that the webhook cannot
 * actually produce — and were diagnosed as one. Tag the origin and the
 * question "could a real DM do this?" is answerable from the row itself.
 */
export type TraceSource =
  /** Real inbound Instagram DM via the webhook. The only production traffic. */
  | 'instagram'
  /** Instagram learning-mode dry run — engine ran, nothing was sent. */
  | 'instagram_dry_run'
  /** Admin → Simulator page → Live DM console (hand-typed, media optional). */
  | 'live_console'
  /** Admin → Simulator page → a predefined scenario run. */
  | 'simulator_scenario'
  /** `npm run simulate` from the CLI. */
  | 'simulator_cli'
  /** Public marketing demo widget. */
  | 'demo_widget'
  /** Conversation-test-runner fixtures. */
  | 'conversation_test'
  /** Manual replay/re-drive through the conversations API. */
  | 'manual_api'
  /** Caller didn't say — pre-migration rows, or a new call site that forgot. */
  | 'unknown';

@Entity('conversation_traces')
export class ConversationTrace {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  traceId!: string;

  /**
   * Origin of the turn. Indexed: the first thing you do when triaging a trace
   * is establish whether it came from real traffic or from a test tool.
   */
  @Index()
  @Column({ type: 'text', default: 'unknown' })
  source!: TraceSource;

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

  /** Full per-call OpenAI usage breakdown. Mirrors `ctx.openaiCalls`
   *  collected during `process()`. The flatter `openaiRequestIds` column
   *  stays for quick text-array indexing; the JSONB here is for the
   *  rich admin UI row-level rendering. */
  @Column({ type: 'jsonb', nullable: true })
  openaiCalls!: OpenAiCallRecord[] | null;

  /** Snapshot of `AssistantMemory` at the start of the turn — the inputs
   *  the engine reasoned over. Used by the admin Trace tab to debug
   *  why a particular branch fired without re-running the engine. */
  @Column({ type: 'jsonb', nullable: true })
  memoryBefore!: Record<string, unknown> | null;

  /** Snapshot of `AssistantMemory` at end of turn (post-state-update). */
  @Column({ type: 'jsonb', nullable: true })
  memoryAfter!: Record<string, unknown> | null;

  /** The last-N message window handed to the classifier — same array as
   *  `ReplyEngineInput.recentMessages`. Lets the admin spot which prior
   *  turn the classifier leaked an entity from. */
  @Column({ type: 'jsonb', nullable: true })
  recentMessages!: Array<{ role: string; text: string | null }> | null;

  /** The rendered reply text the engine returned, including any
   *  extraReplies joined with `\n\n---\n\n`. Lets the admin sanity-check
   *  template interpolation. */
  @Column({ type: 'text', nullable: true })
  outboundReply!: string | null;

  @Column({ type: 'jsonb', nullable: true })
  error!: ConversationTraceError | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
