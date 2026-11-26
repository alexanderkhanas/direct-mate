import { BadRequestException, ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { toString as qrToString } from 'qrcode';
import { DataSource, EntityManager } from 'typeorm';
import { CryptoService } from '../../../common/crypto.service';
import { returnedRows } from '../../../common/db';
import { SessionsService } from '../sessions.service';
import { assertNotLocked, recordFailure } from '../login-attempts';
import { generateRecoveryCodes, hashRecoveryCode } from './recovery-codes';
import { generateSecret, otpauthUri, verifyTotp } from './totp';

export interface TwoFactorSetup {
  /** The key typed in by hand when the QR code can't be scanned. */
  secret: string;
  otpauthUri: string;
  /** The QR code of `otpauthUri`, as an SVG data URL. */
  qr: string;
}

/** A code from the authenticator app, or one of the recovery codes. */
export interface TwoFactorProof {
  code?: string;
  recoveryCode?: string;
}

export interface TwoFactorStatus {
  enabled: boolean;
  required: boolean;
  recoveryCodesLeft: number;
}

/**
 * Two-factor sign-in with an authenticator app (totp.ts). Setup keeps the new
 * secret as pending until a code from it shows the scan worked; turning 2FA on
 * or off ends the user's other sessions. Wrong codes count towards the
 * account's lock (login-attempts.ts), the same as wrong passwords.
 */
@Injectable()
export class TwoFactorService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly crypto: CryptoService,
    private readonly sessions: SessionsService,
  ) {}

  async status(userId: string): Promise<TwoFactorStatus> {
    const state = await this.sessions.state(userId);
    const [{ left }]: Array<{ left: number }> = await this.dataSource.query(
      `SELECT count(*)::int AS left FROM user_recovery_codes WHERE user_id = $1 AND used_at IS NULL`,
      [userId],
    );
    return { enabled: !!state?.twoFactorEnabled, required: !!state?.twoFactorRequired, recoveryCodesLeft: left };
  }

  /** A new secret to scan. Replaces any setup that wasn't finished. */
  async startSetup(userId: string): Promise<TwoFactorSetup> {
    const [user]: Array<{ email: string; totp_enabled_at: Date | null }> = await this.dataSource.query(
      `SELECT email, totp_enabled_at FROM users WHERE id = $1`,
      [userId],
    );
    if (!user) throw new BadRequestException('No such user');
    if (user.totp_enabled_at) {
      throw new ConflictException({ message: 'Two-factor sign-in is already on', details: { code: 'already_enabled' } });
    }
    const secret = generateSecret();
    await this.dataSource.query(
      `UPDATE users SET totp_pending_secret_encrypted = $2, updated_at = now() WHERE id = $1`,
      [userId, this.crypto.encrypt(secret)],
    );
    const uri = otpauthUri(secret, user.email);
    const svg = await qrToString(uri, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
    return { secret, otpauthUri: uri, qr: `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}` };
  }

  /**
   * Turns 2FA on with a code from the pending secret: the user's other
   * sessions end and a fresh set of recovery codes is returned (shown once).
   * Null when the code doesn't match.
   */
  async enable(userId: string, code: string, now = new Date()): Promise<string[] | null> {
    const [user]: Array<{ totp_pending_secret_encrypted: string | null; totp_enabled_at: Date | null; locked_until: Date | null }> =
      await this.dataSource.query(
        `SELECT totp_pending_secret_encrypted, totp_enabled_at, locked_until FROM users WHERE id = $1`,
        [userId],
      );
    if (user?.totp_enabled_at) {
      throw new ConflictException({ message: 'Two-factor sign-in is already on', details: { code: 'already_enabled' } });
    }
    if (!user?.totp_pending_secret_encrypted) {
      throw new BadRequestException({ message: 'Start the setup first', details: { code: 'no_setup' } });
    }
    assertNotLocked(user.locked_until, now);
    const step = verifyTotp(this.crypto.decrypt(user.totp_pending_secret_encrypted), code, now.getTime(), null);
    if (step === null) {
      await recordFailure(this.dataSource, userId);
      return null;
    }
    const codes = generateRecoveryCodes();
    await this.dataSource.transaction(async (manager) => {
      await manager.query(
        `UPDATE users SET totp_secret_encrypted = totp_pending_secret_encrypted,
                          totp_pending_secret_encrypted = NULL,
                          totp_enabled_at = $2, totp_last_step = $3, sessions_valid_after = $2, updated_at = now()
          WHERE id = $1`,
        [userId, now, step],
      );
      await this.replaceRecoveryCodes(manager, userId, codes);
    });
    this.sessions.forget(userId);
    return codes;
  }

  /**
   * Whether the proof is good: a code from the app not used before, or an
   * unused recovery code (spent by this). A wrong one counts towards the lock.
   */
  async check(userId: string, proof: TwoFactorProof, now = new Date()): Promise<boolean> {
    const [user]: Array<{ totp_secret_encrypted: string | null; totp_last_step: string | null; locked_until: Date | null }> =
      await this.dataSource.query(
        `SELECT totp_secret_encrypted, totp_last_step, locked_until FROM users WHERE id = $1`,
        [userId],
      );
    if (!user?.totp_secret_encrypted) return false;
    assertNotLocked(user.locked_until, now);
    const ok = proof.code
      ? await this.useCode(userId, user.totp_secret_encrypted, user.totp_last_step, proof.code, now)
      : proof.recoveryCode
        ? await this.useRecoveryCode(userId, proof.recoveryCode)
        : false;
    if (!ok) await recordFailure(this.dataSource, userId);
    return ok;
  }

  /** Turns 2FA off (refused while it's required of the user); the user's sessions end. */
  async disable(userId: string, proof: TwoFactorProof, now = new Date()): Promise<boolean> {
    const state = await this.sessions.state(userId);
    if (state?.twoFactorRequired) {
      throw new ForbiddenException({ message: 'Two-factor sign-in is required for this account', details: { code: 'required' } });
    }
    if (!(await this.check(userId, proof))) return false;
    await this.dataSource.transaction(async (manager) => {
      await manager.query(
        `UPDATE users SET totp_secret_encrypted = NULL, totp_pending_secret_encrypted = NULL, totp_enabled_at = NULL,
                          totp_last_step = NULL, sessions_valid_after = $2, updated_at = now()
          WHERE id = $1`,
        [userId, now],
      );
      await manager.query(`DELETE FROM user_recovery_codes WHERE user_id = $1`, [userId]);
    });
    this.sessions.forget(userId);
    return true;
  }

  /** A new set of recovery codes; the old ones stop working. Null when the proof is wrong. */
  async regenerateRecoveryCodes(userId: string, proof: TwoFactorProof): Promise<string[] | null> {
    if (!(await this.check(userId, proof))) return null;
    const codes = generateRecoveryCodes();
    await this.dataSource.transaction((manager) => this.replaceRecoveryCodes(manager, userId, codes));
    return codes;
  }

  private async useCode(userId: string, secretEncrypted: string, lastStep: string | null, code: string, now: Date): Promise<boolean> {
    const step = verifyTotp(this.crypto.decrypt(secretEncrypted), code, now.getTime(), lastStep === null ? null : Number(lastStep));
    if (step === null) return false;
    // Claimed atomically: two requests with the same code can't both get in.
    const claimed = returnedRows<{ id: string }>(
      await this.dataSource.query(
        `UPDATE users SET totp_last_step = $2 WHERE id = $1 AND (totp_last_step IS NULL OR totp_last_step < $2) RETURNING id`,
        [userId, step],
      ),
    );
    return claimed.length === 1;
  }

  private async useRecoveryCode(userId: string, code: string): Promise<boolean> {
    const used = returnedRows<{ id: string }>(
      await this.dataSource.query(
        `UPDATE user_recovery_codes SET used_at = now()
          WHERE user_id = $1 AND code_hash = $2 AND used_at IS NULL RETURNING id`,
        [userId, hashRecoveryCode(code)],
      ),
    );
    return used.length === 1;
  }

  private async replaceRecoveryCodes(manager: EntityManager, userId: string, codes: string[]): Promise<void> {
    await manager.query(`DELETE FROM user_recovery_codes WHERE user_id = $1`, [userId]);
    await manager.query(
      `INSERT INTO user_recovery_codes (user_id, code_hash) SELECT $1, unnest($2::text[])`,
      [userId, codes.map(hashRecoveryCode)],
    );
  }
}
