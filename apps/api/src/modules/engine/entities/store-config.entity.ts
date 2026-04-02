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
