import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { CheckoutSession } from './checkout-session.entity';

@Entity('checkout_customer_info')
export class CheckoutCustomerInfo {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', unique: true })
  checkoutSessionId!: string;

  @Column({ type: 'text', nullable: true })
  fullName!: string | null;

  @Column({ type: 'text', nullable: true })
  phone!: string | null;

  @Column({ type: 'text', nullable: true })
  city!: string | null;

  @Column({ type: 'text', nullable: true })
  deliveryProvider!: string | null;

  @Column({ type: 'text', nullable: true })
  branch!: string | null;

  @Column({ type: 'text', nullable: true })
  paymentMethod!: string | null;

  @Column({ type: 'text', nullable: true })
  comment!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;

  @OneToOne(() => CheckoutSession, (s) => s.customerInfo, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'checkout_session_id' })
  checkoutSession!: CheckoutSession;
}
