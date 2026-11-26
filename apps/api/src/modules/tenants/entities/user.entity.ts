import {
  Column,
  CreateDateColumn,
  Entity,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { UserRole } from '@direct-mate/shared';
import { Tenant } from './tenant.entity';

@Entity('users')
@Unique(['tenantId', 'email'])
export class User {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  tenantId!: string;

  @Column({ type: 'text' })
  email!: string;

  @Column({ type: 'text' })
  passwordHash!: string;

  @Column({ type: 'text' })
  role!: UserRole;

  @Column({ type: 'boolean', default: true })
  isActive!: boolean;

  /** The authenticator app's shared secret, encrypted (CryptoService). Set once 2FA is on. */
  @Column({ type: 'text', nullable: true })
  totpSecretEncrypted!: string | null;

  /** A secret shown during setup, kept until the first code from it confirms the scan. */
  @Column({ type: 'text', nullable: true })
  totpPendingSecretEncrypted!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  totpEnabledAt!: Date | null;

  /** The 30-second step of the last code accepted: a code works once. bigint, so a string. */
  @Column({ type: 'bigint', nullable: true })
  totpLastStep!: string | null;

  /** Login tokens issued before this no longer count (2FA turned on or off, «sign out everywhere»). */
  @Column({ type: 'timestamptz', nullable: true })
  sessionsValidAfter!: Date | null;

  @Column({ type: 'integer', default: 0 })
  failedLogins!: number;

  @Column({ type: 'timestamptz', nullable: true })
  lockedUntil!: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;

  @ManyToOne(() => Tenant, (tenant) => tenant.users, { onDelete: 'CASCADE' })
  tenant!: Tenant;
}
