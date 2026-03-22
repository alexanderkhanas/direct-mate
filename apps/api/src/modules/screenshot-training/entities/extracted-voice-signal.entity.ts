import {
  Column,
  CreateDateColumn,
  Entity,
  ManyToOne,
  JoinColumn,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { ExtractedConversationFragment } from './extracted-conversation-fragment.entity';

@Entity('extracted_voice_signals')
export class ExtractedVoiceSignal {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  tenantId!: string;

  @Column({ type: 'uuid' })
  fragmentId!: string;

  @Column({ type: 'text' })
  signalType!: string;

  @Column({ type: 'text' })
  signalValue!: string;

  @Column({ type: 'text', nullable: true })
  evidenceText!: string | null;

  @Column({ type: 'real', default: 0 })
  confidenceScore!: number;

  @Column({ type: 'text', default: 'pending' })
  approvalStatus!: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @ManyToOne(() => ExtractedConversationFragment, (fragment) => fragment.voiceSignals, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'fragment_id' })
  fragment!: ExtractedConversationFragment;
}
