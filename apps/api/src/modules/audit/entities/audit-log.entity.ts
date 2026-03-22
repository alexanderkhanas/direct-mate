import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { AuditLogStatus, AuditLogType } from '@direct-mate/shared';

@Entity('audit_logs')
@Index(['tenantId'])
@Index(['conversationId'])
@Index(['type'])
@Index(['createdAt'])
export class AuditLog {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  tenantId!: string;

  @Column({ type: 'uuid', nullable: true })
  conversationId!: string | null;

  @Column({ type: 'text' })
  type!: AuditLogType;

  @Column({ type: 'text', default: AuditLogStatus.Success })
  status!: AuditLogStatus;

  @Column({ type: 'jsonb', nullable: true })
  details!: Record<string, unknown> | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
