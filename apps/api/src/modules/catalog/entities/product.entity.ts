import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinTable,
  ManyToMany,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ProductStatus } from '@direct-mate/shared';
import { ProductVariant } from './product-variant.entity';
import { ProductMedia } from './product-media.entity';
import { Category } from './category.entity';

@Entity('products')
@Index(['tenantId'])
@Index(['externalProductId'])
export class Product {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  tenantId!: string;

  @Column({ type: 'text', nullable: true })
  externalProductId!: string | null;

  @Column({ type: 'text', nullable: true })
  sku!: string | null;

  @Column({ type: 'text' })
  title!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  /**
   * AI-enriched search blob. Populated at sync time by the n8n
   * normalization step (same OpenAI tool-call that emits the cleaned
   * title / brand / model). A fat Ukrainian-heavy text mixing color
   * synonyms (Чорний / Чорна / Чорне / Black), garment terms, and
   * style / fabric / occasion / fit tags. Indexed with pg_trgm so
   * ILIKE remains cheap.
   *
   * Used by `availabilityService.searchAllByTitle` (OR'd against
   * `products.title`) so the existing keyword loop transparently
   * picks up enriched matches without a new search tier.
   */
  @Column({ type: 'text', nullable: true })
  searchKeywords!: string | null;

  /**
   * Legacy single-category text field. Kept for back-compat with
   * existing readers (catalog.listProducts, etc). Sync writes the first
   * input category here as a denormalized convenience; the `categories`
   * M2M relation below is the source of truth for multi-category.
   */
  @Column({ type: 'text', nullable: true })
  category!: string | null;

  @Column({ type: 'text', nullable: true })
  brand!: string | null;

  @Column({ type: 'text', nullable: true })
  material!: string | null;

  /** Normalized to: 'male' | 'female' | 'unisex' | 'kids' | null. */
  @Column({ type: 'text', nullable: true })
  gender!: string | null;

  @Column({ type: 'text', nullable: true })
  season!: string | null;

  @Column({ type: 'numeric', precision: 10, scale: 2, nullable: true })
  salePrice!: number | null;

  @Column({ type: 'text', nullable: true })
  modelName!: string | null;

  @Column({ type: 'text', default: ProductStatus.Active })
  status!: ProductStatus;

  @Column({ type: 'jsonb', nullable: true })
  metadata!: Record<string, unknown> | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;

  // Bumped on every successful per-product sync touch, even when the
  // diff-skip optimization avoided a row UPDATE. Use this for "last
  // seen in feed" UI; use `updatedAt` for "last column changed".
  @Column({ name: 'last_synced_at', type: 'timestamptz', nullable: true })
  lastSyncedAt!: Date | null;

  @OneToMany(() => ProductVariant, (v) => v.product)
  variants!: ProductVariant[];

  @OneToMany(() => ProductMedia, (m) => m.product)
  media!: ProductMedia[];

  @ManyToMany(() => Category, (c) => c.products)
  @JoinTable({
    name: 'product_categories',
    joinColumn: { name: 'product_id', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'category_id', referencedColumnName: 'id' },
  })
  categories!: Category[];
}
