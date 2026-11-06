import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

@Entity('store_configs')
@Unique(['tenantId'])
export class StoreConfig {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  tenantId!: string;

  // Keys read by the v2 agent (validated where they're read, since owners edit
  // them):
  //   brandConfig.welcomeLine           first-reply line, incl. the AI disclosure
  //   brandConfig.disallowedPhrases     string[] the style guard rejects (e.g. 💛)
  //   checkoutConfig.fields             fields an order draft needs
  //   checkoutConfig.paymentDetails     exact text send_payment_details sends
  //   handoffConfig.announceText        line telling the customer a manager takes over
  //   flowConfig.conversationIdleHours  idle gap that starts a new conversation (24)
  @Column({ type: 'jsonb', default: '{}' })
  brandConfig!: Record<string, unknown>;

  @Column({ type: 'jsonb', default: '{}' })
  flowConfig!: Record<string, unknown>;

  @Column({ type: 'jsonb', default: '{}' })
  checkoutConfig!: Record<string, unknown>;

  @Column({ type: 'jsonb', default: '{}' })
  escalationConfig!: Record<string, unknown>;

  @Column({ type: 'jsonb', default: '{}' })
  recommendationConfig!: Record<string, unknown>;

  @Column({ type: 'jsonb', default: '{}' })
  handoffConfig!: Record<string, unknown>;

  @Column({ type: 'jsonb', default: '{}' })
  fallbackConfig!: Record<string, unknown>;

  /** The store's own notes on delivery, payment, returns and fit; goes into the agent prompt. */
  @Column({ type: 'text', nullable: true })
  knowledgeDoc!: string | null;

  @Column({ name: 'operating_mode', default: 'active' })
  operatingMode!: 'learning' | 'active' | 'paused';

  @Column({ name: 'learning_started_at', type: 'timestamptz', nullable: true })
  learningStartedAt!: Date | null;

  @Column({ name: 'learning_notified_at', type: 'timestamptz', nullable: true })
  learningNotifiedAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
