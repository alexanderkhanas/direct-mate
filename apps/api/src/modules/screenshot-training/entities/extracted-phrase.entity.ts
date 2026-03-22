import {
  Column,
  CreateDateColumn,
  Entity,
  ManyToOne,
  JoinColumn,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { ExtractedConversationFragment } from './extracted-conversation-fragment.entity';

@Entity('extracted_phrases')
export class ExtractedPhrase {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  tenantId!: string;

  @Column({ type: 'uuid' })
  fragmentId!: string;

  @Column({ type: 'text' })
  phrase!: string;

  @Column({ type: 'text' })
  phraseType!: string;

  @Column({ type: 'text', nullable: true })
  scenario!: string | null;

  @Column({ type: 'real', default: 0 })
  confidenceScore!: number;

  @Column({ type: 'text', default: 'pending' })
  approvalStatus!: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @ManyToOne(() => ExtractedConversationFragment, (fragment) => fragment.phrases, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'fragment_id' })
  fragment!: ExtractedConversationFragment;
}
