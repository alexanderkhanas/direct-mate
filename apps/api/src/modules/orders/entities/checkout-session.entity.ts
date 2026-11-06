import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { CheckoutSessionStatus } from '@direct-mate/shared';
import { CheckoutItem } from './checkout-item.entity';
import { CheckoutCustomerInfo } from './checkout-customer-info.entity';

@Entity('checkout_sessions')
// The agent's order draft: at most one open session per conversation.
@Index(['conversationId'], {
  unique: true,
  where: `"status" IN ('collecting_customer_info', 'ready_for_draft_order')`,
})
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

  /** Set when payment details were sent for this draft; they go out at most once. */
  @Column({ type: 'timestamptz', nullable: true })
  paymentDetailsSentAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;

  @OneToMany(() => CheckoutItem, (i) => i.checkoutSession)
  items!: CheckoutItem[];

  @OneToOne(() => CheckoutCustomerInfo, (info) => info.checkoutSession)
  customerInfo!: CheckoutCustomerInfo;
}
