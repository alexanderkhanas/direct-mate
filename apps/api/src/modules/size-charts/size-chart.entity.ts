import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { SizeChartStatus, SizeChartTable } from './size-chart-table';

@Entity('size_charts')
@Index(['tenantId'])
export class SizeChart {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  tenantId!: string;

  @Column({ type: 'text' })
  name!: string;

  /** Null for a chart read in the Claude chat: only its table was saved. */
  @Column({ type: 'text', nullable: true })
  imagePath!: string | null;

  @Column({ type: 'text', array: true, default: '{}' })
  categories!: string[];

  @Column({ type: 'text', array: true, default: '{}' })
  brands!: string[];

  @Column({ type: 'boolean', default: false })
  isDefault!: boolean;

  /** The chart read into data; null for an image-only chart. */
  @Column({ type: 'jsonb', nullable: true })
  table!: SizeChartTable | null;

  @Column({ type: 'text', default: 'image' })
  status!: SizeChartStatus;

  /** Send the chart's picture to the customer with a recommendation. */
  @Column({ type: 'boolean', default: true })
  sendImage!: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
