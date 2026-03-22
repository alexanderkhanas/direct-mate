import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ScreenshotImportFile } from './screenshot-import-file.entity';

@Entity('screenshot_import_jobs')
export class ScreenshotImportJob {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  tenantId!: string;

  @Column({ type: 'text', default: 'pending' })
  status!: string;

  @Column({ type: 'uuid' })
  createdByUserId!: string;

  @Column({ type: 'int', default: 0 })
  totalFiles!: number;

  @Column({ type: 'int', default: 0 })
  processedFiles!: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  completedAt!: Date | null;

  @OneToMany(() => ScreenshotImportFile, (file) => file.job)
  files!: ScreenshotImportFile[];
}
