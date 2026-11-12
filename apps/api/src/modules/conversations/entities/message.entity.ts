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

/** Attachments that point at a story, post or reel, whose image the agent is shown (`ContentMediaService`). */
export const CONTENT_ATTACHMENTS: ReadonlySet<MessageAttachment['type']> = new Set([
  'story_reply',
  'post_reply',
  'post_share',
  'post_comment',
]);

/**
 * Something a message carried besides text: a customer's photo (with our
 * copy), or the story, post or reel they replied to, shared or commented on
 * (with our copy of its image, or of frames from its video, and its caption).
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
    | 'customer_file'
    /** The customer mentioned the shop in their own story. */
    | 'story_mention'
    /** A quote-reply to an earlier message in the thread (Instagram `reply_to.mid`). */
    | 'quoted_message'
    /** A comment under one of the shop's posts, answered here by private reply. */
    | 'post_comment';
  /** The Instagram media id, for a customer's photo the URL it came from, for a quote the quoted message's id. */
  mediaId: string;
  /** What the quoted message said, looked up when the reply arrived. */
  quotedText?: string;
  /**
   * Our copy, re-sent to the agent as an image on later turns: a customer's
   * photo (`CustomerMediaService`), or a story's, post's or reel's image
   * (`ContentMediaService`; what it shows is in `image`).
   */
  url?: string;
  /** Why a customer's photo has no copy. */
  error?: 'download_failed' | 'too_large' | 'unreadable';

  // Stories, posts and reels only.
  /** The content's link from the webhook (Meta's CDN, expires within a day), to make our copy from. */
  sourceUrl?: string;
  /** The content's caption (a shared post's title, or from Graph). */
  caption?: string;
  /** A shared reel, not a feed post. */
  reel?: boolean;
  /** Posted by another account, not the shop: the agent may say a product looks like it, not that it's the same. */
  foreign?: boolean;
  /** What `url` shows: the content's own picture, frames from its video tiled into one image, or the video's cover. */
  image?: 'picture' | 'video_frames' | 'video_cover';
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

  /** For bot messages sent to Instagram: whether they reached the customer. A failed one is left out of the agent's history. */
  @Column({ type: 'text', nullable: true })
  deliveryStatus!: 'sent' | 'failed' | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @ManyToOne(() => Conversation, (c) => c.messages, { onDelete: 'CASCADE' })
  conversation!: Conversation;
}
