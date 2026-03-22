import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ProductVariant } from './product-variant.entity';

@Entity('stock_balances')
@Index(['variantId'])
@Index(['lastSyncedAt'])
export class StockBalance {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  variantId!: string;

  @Column({ type: 'text', nullable: true })
  warehouseCode!: string | null;

  @Column({ type: 'integer', default: 0 })
  availableQty!: number;

  @Column({ type: 'integer', default: 0 })
  reservedQty!: number;

  @Column({ type: 'integer', default: 0 })
  pendingCheckoutQty!: number;

  @Column({ type: 'timestamptz', nullable: true })
  lastSyncedAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;

  get effectiveAvailable(): number {
    return this.availableQty - this.reservedQty - this.pendingCheckoutQty;
  }

  @OneToOne(() => ProductVariant, (v) => v.stockBalance, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'variant_id' })
  variant!: ProductVariant;
}
