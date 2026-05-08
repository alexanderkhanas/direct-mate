import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  ManyToOne,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Product } from './product.entity';
import { StockBalance } from './stock-balance.entity';

@Entity('product_variants')
@Index(['productId'])
@Index(['color'])
@Index(['size'])
export class ProductVariant {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  productId!: string;

  /**
   * Denormalized from products.tenant_id so we can express a
   * tenant-scoped UNIQUE(barcode) partial index. Postgres rejects
   * subqueries in index expressions, so a real column is required.
   * Sync code populates this from the parent product.
   */
  @Column({ type: 'uuid' })
  tenantId!: string;

  @Column({ type: 'text', nullable: true })
  externalVariantId!: string | null;

  @Column({ type: 'text', nullable: true })
  sku!: string | null;

  @Column({ type: 'text', nullable: true })
  barcode!: string | null;

  @Column({ type: 'text', nullable: true })
  color!: string | null;

  @Column({ type: 'text', nullable: true })
  size!: string | null;

  @Column({ type: 'numeric', precision: 10, scale: 2 })
  price!: number;

  @Column({ type: 'numeric', precision: 10, scale: 2, nullable: true })
  salePrice!: number | null;

  @Column({ type: 'text', default: 'UAH' })
  currency!: string;

  @Column({ type: 'boolean', default: true })
  active!: boolean;

  @Column({ type: 'text', nullable: true })
  imageUrl!: string | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata!: Record<string, unknown> | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;

  // See products.lastSyncedAt: bumped on every sync touch, separate
  // from updated_at (real field changes) and stock.lastSyncedAt (qty
  // changes).
  @Column({ name: 'last_synced_at', type: 'timestamptz', nullable: true })
  lastSyncedAt!: Date | null;

  @ManyToOne(() => Product, (p) => p.variants, { onDelete: 'CASCADE' })
  product!: Product;

  @OneToOne(() => StockBalance, (s) => s.variant)
  stockBalance!: StockBalance;
}
