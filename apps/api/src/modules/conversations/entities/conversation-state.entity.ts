import {
  Column,
  Entity,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ConversationStateStatus } from '@direct-mate/shared';
import { Conversation } from './conversation.entity';

@Entity('conversation_state')
export class ConversationState {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', unique: true })
  conversationId!: string;

  @Column({ type: 'text', default: ConversationStateStatus.Browsing })
  stateStatus!: ConversationStateStatus;

  @Column({ type: 'uuid', nullable: true })
  selectedProductId!: string | null;

  @Column({ type: 'uuid', nullable: true })
  selectedVariantId!: string | null;

  @Column({ type: 'uuid', nullable: true })
  activeCheckoutSessionId!: string | null;

  @Column({ type: 'numeric', precision: 4, scale: 3, nullable: true })
  lastAiConfidence!: number | null;

  @Column({ type: 'jsonb', nullable: true })
  contextJson!: Record<string, unknown> | null;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;

  @OneToOne(() => Conversation, (c) => c.state, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'conversation_id' })
  conversation!: Conversation;
}
