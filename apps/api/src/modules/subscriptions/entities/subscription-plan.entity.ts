import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('subscription_plans')
export class SubscriptionPlan {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  tenantId!: string;

  @Column({ type: 'text', default: 'trial' })
  planType!: string; // trial, starter, professional, business

  @Column({ type: 'text', default: 'active' })
  status!: string; // active, past_due, cancelled, expired

  @Column({ type: 'timestamptz', nullable: true })
  trialEndsAt!: Date | null;

  /** When the owner turned the bot on; null while the trial waits for go-live. */
  @Column({ type: 'timestamptz', nullable: true })
  trialStartedAt!: Date | null;

  /** Reminders already sent (`days_3`, `days_1`, `conv_80`, `conv_100`, `expired`), so each goes once. */
  @Column({ type: 'text', array: true, default: '{}' })
  remindersSent!: string[];

  @Column({ type: 'timestamptz', nullable: true })
  currentPeriodStart!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  currentPeriodEnd!: Date | null;

  @Column({ type: 'text', nullable: true })
  monoSubscriptionId!: string | null;

  @Column({ type: 'int', nullable: true })
  amount!: number | null; // kopiyky

  @Column({ type: 'int', default: 980 })
  currency!: number;

  @Column({ type: 'int', nullable: true })
  conversationLimit!: number | null; // null = unlimited

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
