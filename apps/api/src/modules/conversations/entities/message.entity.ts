import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { MessageDirection, MessageRole } from '@direct-mate/shared';
import { Conversation } from './conversation.entity';

@Entity('messages')
@Index(['conversationId'])
@Index(['externalMessageId'])
@Index(['createdAt'])
export class Message {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  conversationId!: string;

  @Column({ type: 'uuid' })
  tenantId!: string;

  @Column({ type: 'text' })
  direction!: MessageDirection;

  @Column({ type: 'text' })
  role!: MessageRole;

  @Column({ type: 'text', nullable: true })
  externalMessageId!: string | null;

  @Column({ type: 'text', nullable: true })
  text!: string | null;

  @Column({ type: 'jsonb', nullable: true })
  rawPayload!: Record<string, unknown> | null;

  @Column({ type: 'jsonb', nullable: true })
  toolCalls!: unknown[] | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @ManyToOne(() => Conversation, (c) => c.messages, { onDelete: 'CASCADE' })
  conversation!: Conversation;
}
