import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('size_charts')
@Index(['tenantId'])
export class SizeChart {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  tenantId!: string;

  @Column({ type: 'text' })
  name!: string;

  @Column({ type: 'text' })
  imagePath!: string;

  @Column({ type: 'text', array: true, default: '{}' })
  categories!: string[];

  @Column({ type: 'text', array: true, default: '{}' })
  brands!: string[];

  @Column({ type: 'boolean', default: false })
  isDefault!: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
