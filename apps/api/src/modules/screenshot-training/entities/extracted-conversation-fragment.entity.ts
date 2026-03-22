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

  @Column({ type: 'uuid' })
  fileId!: string;

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
