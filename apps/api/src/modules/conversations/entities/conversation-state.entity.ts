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

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;

  @OneToOne(() => Conversation, (c) => c.state, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'conversation_id' })
  conversation!: Conversation;
}
