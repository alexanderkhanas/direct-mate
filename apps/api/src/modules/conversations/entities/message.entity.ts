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

/**
 * Something a message carried besides text. Same shape as the media reference
 * the Instagram ingest already extracts (`extractMediaReference`), plus our
 * copy of a customer's photo.
 */
export interface MessageAttachment {
  type:
    | 'story_reply'
    | 'post_reply'
    | 'post_share'
    | 'customer_photo'
    // The agent can't open these; it is told one was sent and asks for a photo or text.
    | 'customer_video'
    | 'customer_audio'
    | 'customer_file';
  /** The Instagram media id, or for a customer's photo the URL it came from. */
  mediaId: string;
  /** Our copy of a customer's photo (`CustomerMediaService`), re-sent to the agent on later turns. */
  url?: string;
  /** Why a customer's photo has no copy. */
  error?: 'download_failed' | 'too_large' | 'unreadable';
}

@Entity('messages')
@Index(['conversationId'])
@Index(['externalMessageId'])
@Index(['createdAt'])
// A redelivered webhook carries the same mid; this is what drops it.
@Index(['tenantId', 'externalMessageId'], {
  unique: true,
  where: '"external_message_id" IS NOT NULL',
})
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

  @Column({ type: 'jsonb', nullable: true })
  attachments!: MessageAttachment[] | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @ManyToOne(() => Conversation, (c) => c.messages, { onDelete: 'CASCADE' })
  conversation!: Conversation;
}
