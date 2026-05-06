import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  ManyToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Product } from './product.entity';

/**
 * Tenant-scoped product category. Many-to-many with products.
 *
 * Uniqueness within a tenant is case-insensitive — enforced by the
 * partial unique index `idx_categories_tenant_lower_name_uniq` on
 * `(tenant_id, lower(name))`. Sync code upserts using the same
 * lowercase comparison so "Верхній одяг" and "верхній одяг" collapse
 * to one row.
 */
@Entity('categories')
@Index(['tenantId'])
export class Category {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  tenantId!: string;

  @Column({ type: 'text' })
  name!: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;

  @ManyToMany(() => Product, (p) => p.categories)
  products!: Product[];
}
