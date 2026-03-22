import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { CheckoutSessionStatus } from '@direct-mate/shared';
import { CheckoutItem } from './checkout-item.entity';
import { CheckoutCustomerInfo } from './checkout-customer-info.entity';

@Entity('checkout_sessions')
export class CheckoutSession {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  tenantId!: string;

  @Column({ type: 'uuid' })
  conversationId!: string;

  @Column({ type: 'uuid' })
  customerId!: string;

  @Column({ type: 'text', default: CheckoutSessionStatus.CollectingCustomerInfo })
  status!: CheckoutSessionStatus;

  @Column({ type: 'uuid', nullable: true })
  reservationId!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  expiresAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;

  @OneToMany(() => CheckoutItem, (i) => i.checkoutSession)
  items!: CheckoutItem[];

  @OneToOne(() => CheckoutCustomerInfo, (info) => info.checkoutSession)
  customerInfo!: CheckoutCustomerInfo;
}
