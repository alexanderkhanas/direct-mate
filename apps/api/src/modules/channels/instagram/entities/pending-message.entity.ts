import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('pending_messages')
export class PendingMessage {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'text' })
  debounceKey!: string;

  @Column({ type: 'uuid' })
  tenantId!: string;

  @Column({ type: 'text' })
  externalUserId!: string;

  @Column({ type: 'text' })
  channelAccountId!: string;

  @Column({ type: 'uuid' })
  connectionId!: string;

  @Column({ type: 'text' })
  messageId!: string;

  @Column({ type: 'text' })
  messageText!: string;

  @Column({ type: 'jsonb', nullable: true })
  mediaReference!: Record<string, unknown> | null;

  @Column({ type: 'timestamptz' })
  flushAt!: Date;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
