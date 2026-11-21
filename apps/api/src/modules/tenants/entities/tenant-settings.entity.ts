import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { Tenant } from './tenant.entity';

export interface BusinessHours {
  timezone: string;
  days: number[];
  start: string;
  end: string;
}

export interface HandoffRules {
  maxFailedTurns: number;
  stockFreshnessMinutes: number;
  negativeSentimentEscalation: boolean;
}

export interface AiSettings {
  /** Per-store agent model override; falls back to AGENT_MODEL. Not shown in the admin panel. */
  model?: string;
  maxTokens?: number;
  temperature?: number;
  notificationWebhookUrl?: string;
}

@Entity('tenant_settings')
@Unique(['tenantId'])
export class TenantSettings {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  tenantId!: string;

  @Column({ type: 'text', nullable: true })
  brandTonePrompt!: string | null;

  @Column({ type: 'jsonb', default: '[]' })
  supportedLanguages!: string[];

  @Column({ type: 'jsonb', nullable: true })
  businessHours!: BusinessHours | null;

  @Column({ type: 'jsonb', nullable: true })
  handoffRules!: HandoffRules | null;

  @Column({ type: 'jsonb', nullable: true })
  aiSettings!: AiSettings | null;

  /**
   * The owner allowed DirectMate to read the store's Instagram Direct: the
   * one-time history import and learning mode. Null = not allowed. Written
   * only by `DirectPermissionsService`.
   */
  @Column({ type: 'timestamptz', nullable: true })
  directReadAllowedAt!: Date | null;

  /** The owner allowed the AI agent to answer customers (active mode, comment replies). Null = not allowed. */
  @Column({ type: 'timestamptz', nullable: true })
  directReplyAllowedAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;

  @OneToOne(() => Tenant, (tenant) => tenant.settings, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant!: Tenant;
}
