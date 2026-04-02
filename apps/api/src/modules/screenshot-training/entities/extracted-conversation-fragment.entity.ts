import {
  Column,
  CreateDateColumn,
  Entity,
  ManyToOne,
  JoinColumn,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { ScreenshotImportFile } from './screenshot-import-file.entity';
import { ExtractedPhrase } from './extracted-phrase.entity';
import { ExtractedVoiceSignal } from './extracted-voice-signal.entity';

@Entity('extracted_conversation_fragments')
export class ExtractedConversationFragment {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', nullable: true })
  fileId!: string | null;

  @Column({ type: 'uuid' })
  tenantId!: string;

  @Column({ type: 'jsonb' })
  transcriptJson!: Array<{ speaker: string; text: string }>;

  @Column({ type: 'text', nullable: true })
  scenarioSuggestion!: string | null;

  @Column({ type: 'real', default: 0 })
  confidenceScore!: number;

  @Column({ type: 'text', default: 'pending' })
  reviewStatus!: string;

  @Column({ default: 'screenshot' })
  source!: 'screenshot' | 'live_observation';

  // Bot engine analysis (learning mode only)
  @Column({ type: 'jsonb', nullable: true })
  classificationJson!: Record<string, unknown> | null;

  @Column({ type: 'text', nullable: true })
  botReply!: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  templateScenario!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @ManyToOne(() => ScreenshotImportFile, (file) => file.fragments, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'file_id' })
  file!: ScreenshotImportFile;

  @OneToMany(() => ExtractedPhrase, (phrase) => phrase.fragment)
  phrases!: ExtractedPhrase[];

  @OneToMany(() => ExtractedVoiceSignal, (signal) => signal.fragment)
  voiceSignals!: ExtractedVoiceSignal[];
}
