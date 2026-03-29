import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('instagram_media_mappings')
@Index('idx_media_mappings_tenant_media', ['tenantId', 'instagramMediaId'], {
  unique: true,
})
@Index('idx_media_mappings_product', ['productId'])
export class InstagramMediaMapping {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  tenantId!: string;

  @Column({ type: 'text' })
  instagramMediaId!: string;

  @Column({ type: 'text', default: 'post' })
  mediaType!: string;

  @Column({ type: 'uuid', nullable: true })
  productId!: string | null;

  @Column({ type: 'uuid', nullable: true })
  variantId!: string | null;

  @Column({ type: 'text', nullable: true })
  caption!: string | null;

  @Column({ type: 'text', nullable: true })
  mediaUrl!: string | null;

  @Column({ type: 'text', nullable: true })
  permalink!: string | null;

  @Column({ type: 'text', nullable: true })
  matchMethod!: string | null;

  @Column({ type: 'real', nullable: true })
  matchConfidence!: number | null;

  @Column({ type: 'boolean', default: false })
  confirmed!: boolean;

  @Column({ type: 'timestamptz', nullable: true })
  expiresAt!: Date | null;

  @Column({ type: 'timestamptz', default: () => 'now()' })
  fetchedAt!: Date;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
