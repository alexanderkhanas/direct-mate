import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('subscription_plan_configs')
export class SubscriptionPlanConfig {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'text', unique: true })
  planType!: string;

  @Column({ type: 'text' })
  displayName!: string;

  @Column({ type: 'int' })
  price!: number; // kopiyky

  @Column({ type: 'int', default: 980 })
  currency!: number;

  @Column({ type: 'int', nullable: true })
  conversationLimit!: number | null;

  @Column({ type: 'int', default: 1 })
  igAccountsLimit!: number;

  @Column({ type: 'int', nullable: true })
  productsLimit!: number | null;

  @Column({ type: 'int', default: 1 })
  connectionsLimit!: number;

  @Column({ type: 'int', default: 1 })
  teamMembersLimit!: number;

  @Column({ type: 'int', default: 30 })
  historyDays!: number;

  @Column({ type: 'boolean', default: true })
  isActive!: boolean;

  @Column({ type: 'int', default: 0 })
  sortOrder!: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
