import {
  Column,
  CreateDateColumn,
  Entity,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { CheckoutSession } from './checkout-session.entity';

@Entity('checkout_items')
export class CheckoutItem {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  checkoutSessionId!: string;

  @Column({ type: 'uuid' })
  productId!: string;

  @Column({ type: 'uuid' })
  variantId!: string;

  @Column({ type: 'integer', default: 1 })
  qty!: number;

  @Column({ type: 'numeric', precision: 10, scale: 2 })
  unitPrice!: number;

  @Column({ type: 'text', default: 'UAH' })
  currency!: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @ManyToOne(() => CheckoutSession, (s) => s.items, { onDelete: 'CASCADE' })
  checkoutSession!: CheckoutSession;
}
