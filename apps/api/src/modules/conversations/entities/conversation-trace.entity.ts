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

/**
 * Where the turn came from. Every caller of `TurnRunner.run()` sets this, so a
 * trace can never be mistaken for one produced by a different environment.
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
  /** Old YAML conversation-test runner (removed); kept for its existing rows. */
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
  handoffReason!: string | null;

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  traceSteps!: string[];

  /** The conversation history the agent was given for this turn. */
  @Column({ type: 'jsonb', nullable: true })
  recentMessages!: Array<{ role: string; text: string | null }> | null;

  /** The messages sent this turn, joined with `\n\n---\n\n`. */
  @Column({ type: 'text', nullable: true })
  outboundReply!: string | null;

  @Column({ type: 'jsonb', nullable: true })
  error!: ConversationTraceError | null;

  // ─── v2 agent ─────────────────────────────────────────────────
  // Shapes are defined by the agent module; jsonb here so the trace table
  // doesn't depend on it.

  /** Per-step tool calls, arguments, results and text. */
  @Column({ type: 'jsonb', nullable: true })
  agentSteps!: unknown[] | null;

  /** What the grounding and style guards found, and whether a retry happened. */
  @Column({ type: 'jsonb', nullable: true })
  guardResults!: Record<string, unknown> | null;

  /** Model that answered; stores can override it, so it is recorded per turn. */
  @Column({ type: 'text', nullable: true })
  model!: string | null;

  @Column({ type: 'jsonb', nullable: true })
  usage!: Record<string, unknown> | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
