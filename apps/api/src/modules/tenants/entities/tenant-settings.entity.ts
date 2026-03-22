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

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;

  @OneToOne(() => Tenant, (tenant) => tenant.settings, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant!: Tenant;
}
