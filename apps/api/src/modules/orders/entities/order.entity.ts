import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { OrderStatus } from '@direct-mate/shared';
import { OrderItem } from './order-item.entity';

@Entity('orders')
export class Order {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  tenantId!: string;

  @Column({ type: 'uuid', nullable: true })
  checkoutSessionId!: string | null;

  @Column({ type: 'uuid' })
  customerId!: string;

  @Column({ type: 'text', nullable: true })
  externalOrderId!: string | null;

  @Column({ type: 'text', default: OrderStatus.Draft })
  status!: OrderStatus;

  @Column({ type: 'numeric', precision: 10, scale: 2, nullable: true })
  totalAmount!: number | null;

  @Column({ type: 'text', default: 'UAH' })
  currency!: string;

  @Column({ type: 'text', default: 'instagram_ai' })
  source!: string;

  @Column({ type: 'text', default: 'none' })
  externalSyncStatus!: string;

  @Column({ type: 'jsonb', nullable: true })
  externalOrderMetadata!: Record<string, unknown> | null;

  @Column({ type: 'timestamptz', nullable: true })
  externalSyncTriggeredAt!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  externalSyncCompletedAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;

  @OneToMany(() => OrderItem, (i) => i.order)
  items!: OrderItem[];
}
