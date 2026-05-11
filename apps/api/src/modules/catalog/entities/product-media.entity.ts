import {
  Column,
  CreateDateColumn,
  Entity,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Product } from './product.entity';

@Entity('product_media')
export class ProductMedia {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  productId!: string;

  @Column({ type: 'text' })
  url!: string;

  @Column({ type: 'text', nullable: true })
  color!: string | null;

  @Column({ type: 'integer', default: 0 })
  sortOrder!: number;

  // 16-char hex dHash (64 bits) for Hamming-distance matching against
  // customer-attached photos in DMs. NULL when hashing failed at sync
  // time (download / decode error) — those rows can't be matched but
  // still serve as catalog images.
  @Column({ type: 'char', length: 16, nullable: true })
  phash!: string | null;

  // CLIP image embedding (Xenova/clip-vit-base-patch32, 512 × float32 =
  // 2048 bytes), L2-normalized at write time so cosine similarity is a
  // dot product. Used by Stage 2 of customer-photo matching to retrieve
  // semantically-similar candidates before GPT vision verification.
  // NULL when embedding failed or for rows synced before CLIP rollout —
  // the background `ProductMediaEmbedder` worker fills these in
  // asynchronously after the catalog-import returns.
  @Column({ type: 'bytea', nullable: true })
  clipEmbedding!: Buffer | null;

  // Last attempt at computing `clipEmbedding`. NULL = never tried
  // (eligible immediately). Non-NULL with NULL `clipEmbedding` = the
  // try failed; the worker honours 15-min backoff before re-trying so
  // a permanently-broken image URL doesn't dominate the queue.
  @Column({ type: 'timestamptz', nullable: true })
  embeddingAttemptedAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @ManyToOne(() => Product, (p) => p.media, { onDelete: 'CASCADE' })
  product!: Product;
}
