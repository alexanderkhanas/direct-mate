import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { UserRole } from '@direct-mate/shared';
import { JwtPayload } from '../../common/decorators/current-user.decorator';

/** What decides whether a user's login tokens still count. */
export interface UserSecurityState {
  isActive: boolean;
  role: string;
  twoFactorEnabled: boolean;
  /** Superadmins always; anyone in a store that requires it (`tenant_settings.require_two_factor`). */
  twoFactorRequired: boolean;
  sessionsValidAfter: Date | null;
}

/** How long a user's state is trusted before it is read again. */
const CACHE_MS = 60_000;
const CACHE_MAX = 5_000;

/**
 * Login tokens are JWTs, so on their own they'd count until they expire. Every
 * request also checks the person behind the token (the impersonating
 * superadmin for an impersonation token): still active, the token issued after
 * their sessions were last ended, and 2FA on if it's required of them. Read
 * once a minute per user; this process forgets its copy at once when it ends
 * sessions itself.
 */
@Injectable()
export class SessionsService {
  private readonly cache = new Map<string, { state: UserSecurityState | null; at: number }>();

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async state(userId: string): Promise<UserSecurityState | null> {
    const [row]: Array<{
      is_active: boolean;
      role: string;
      totp_enabled_at: Date | null;
      require_two_factor: boolean;
      sessions_valid_after: Date | null;
    }> = await this.dataSource.query(
      `SELECT u.is_active, u.role, u.totp_enabled_at, u.sessions_valid_after,
              COALESCE(ts.require_two_factor, false) AS require_two_factor
         FROM users u LEFT JOIN tenant_settings ts ON ts.tenant_id = u.tenant_id
        WHERE u.id = $1`,
      [userId],
    );
    if (!row) return null;
    return {
      isActive: row.is_active,
      role: row.role,
      twoFactorEnabled: row.totp_enabled_at !== null,
      twoFactorRequired: row.role === UserRole.Superadmin || row.require_two_factor,
      sessionsValidAfter: row.sessions_valid_after ? new Date(row.sessions_valid_after) : null,
    };
  }

  /** Whether a verified login token still counts. */
  async accepts(payload: JwtPayload): Promise<boolean> {
    if (payload.purpose) return false; // a sign-in challenge, not a login
    const holder = payload.imp ?? payload.sub;
    const state = await this.cachedState(holder);
    if (!state?.isActive) return false;
    if (payload.imp && state.role !== UserRole.Superadmin) return false;
    if (state.twoFactorRequired && !state.twoFactorEnabled) return false;
    // Tokens from before `iatMs` existed fall back to `iat`: one issued in the second the sessions ended doesn't count.
    const issuedMs = payload.iatMs ?? (payload.iat ?? 0) * 1000;
    if (state.sessionsValidAfter && issuedMs < state.sessionsValidAfter.getTime()) return false;
    return true;
  }

  /** Every login token the user holds stops counting; a token issued from now on counts. */
  async endAll(userId: string, at = new Date()): Promise<void> {
    await this.dataSource.query(`UPDATE users SET sessions_valid_after = $2, updated_at = now() WHERE id = $1`, [
      userId,
      at,
    ]);
    this.forget(userId);
  }

  forget(userId: string): void {
    this.cache.delete(userId);
  }

  private async cachedState(userId: string): Promise<UserSecurityState | null> {
    const hit = this.cache.get(userId);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.state;
    const state = await this.state(userId);
    if (this.cache.size >= CACHE_MAX) this.cache.clear();
    this.cache.set(userId, { state, at: Date.now() });
    return state;
  }
}
