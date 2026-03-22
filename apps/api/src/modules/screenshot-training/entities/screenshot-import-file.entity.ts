import {
  Column,
  CreateDateColumn,
  Entity,
  ManyToOne,
  JoinColumn,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { ScreenshotImportJob } from './screenshot-import-job.entity';
import { ExtractedConversationFragment } from './extracted-conversation-fragment.entity';

@Entity('screenshot_import_files')
export class ScreenshotImportFile {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  jobId!: string;

  @Column({ type: 'uuid' })
  tenantId!: string;

  @Column({ type: 'text' })
  fileUrl!: string;

  @Column({ type: 'text' })
  fileName!: string;

  @Column({ type: 'text' })
  mimeType!: string;

  @Column({ type: 'text', default: 'pending' })
  ocrStatus!: string;

  @Column({ type: 'text', default: 'pending' })
  extractionStatus!: string;

  @Column({ type: 'text', nullable: true })
  extractedTextRaw!: string | null;

  @Column({ type: 'jsonb', nullable: true })
  extractionMetadata!: Record<string, unknown> | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @ManyToOne(() => ScreenshotImportJob, (job) => job.files, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'job_id' })
  job!: ScreenshotImportJob;

  @OneToMany(() => ExtractedConversationFragment, (fragment) => fragment.file)
  fragments!: ExtractedConversationFragment[];
}
