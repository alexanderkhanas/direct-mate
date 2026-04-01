import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ConversationStatus } from '@direct-mate/shared';
import { Customer } from './customer.entity';
import { Message } from './message.entity';
import { ConversationState } from './conversation-state.entity';

@Entity('conversations')
@Index(['tenantId'])
@Index(['customerId'])
@Index(['status'])
@Index(['lastMessageAt'])
export class Conversation {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  tenantId!: string;

  @Column({ type: 'uuid' })
  customerId!: string;

  @Column({ type: 'text', default: 'instagram' })
  channel!: string;

  @Column({ type: 'text', nullable: true })
  channelAccountId!: string | null;

  @Column({ type: 'text', default: ConversationStatus.Active })
  status!: ConversationStatus;

  @Column({ type: 'boolean', default: false })
  needsHandoff!: boolean;

  @Column({ type: 'text', nullable: true })
  handoffReason!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  lastMessageAt!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  autoResumeAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;

  @ManyToOne(() => Customer, (c) => c.conversations)
  @JoinColumn({ name: 'customer_id' })
  customer!: Customer;

  @OneToMany(() => Message, (m) => m.conversation)
  messages!: Message[];

  @OneToOne(() => ConversationState, (s) => s.conversation)
  state!: ConversationState;
}
