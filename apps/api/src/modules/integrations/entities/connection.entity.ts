import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ConnectionStatus, ConnectionType } from '@direct-mate/shared';
import type { InstagramLoginMethod } from '../../../common/meta-graph';

@Entity('connections')
export class Connection {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  tenantId!: string;

  @Column({ type: 'text' })
  type!: ConnectionType;

  @Column({ type: 'text', default: ConnectionStatus.Pending })
  status!: ConnectionStatus;

  @Column({ type: 'text', nullable: true })
  externalAccountId!: string | null;

  @Column({ type: 'text', nullable: true })
  accessTokenEncrypted!: string | null;

  @Column({ type: 'text', nullable: true })
  refreshTokenEncrypted!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  tokenExpiresAt!: Date | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata!: Record<string, unknown> | null;

  /** Instagram only: the login it was made with, which decides the Graph host and token renewal. */
  @Column({ type: 'text', nullable: true })
  loginMethod!: InstagramLoginMethod | null;

  @Column({ type: 'timestamptz', nullable: true })
  lastSyncAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
