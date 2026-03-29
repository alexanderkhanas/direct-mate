import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ProductStatus } from '@direct-mate/shared';
import { ProductVariant } from './product-variant.entity';
import { ProductMedia } from './product-media.entity';

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

  @Column({ type: 'text', nullable: true })
  category!: string | null;

  @Column({ type: 'text', nullable: true })
  brand!: string | null;

  @Column({ type: 'text', default: ProductStatus.Active })
  status!: ProductStatus;

  @Column({ type: 'jsonb', nullable: true })
  metadata!: Record<string, unknown> | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;

  @OneToMany(() => ProductVariant, (v) => v.product)
  variants!: ProductVariant[];

  @OneToMany(() => ProductMedia, (m) => m.product)
  media!: ProductMedia[];
}
