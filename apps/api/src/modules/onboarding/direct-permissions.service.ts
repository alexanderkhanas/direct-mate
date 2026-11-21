import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { returnedRows } from '../../common/db';
import { HistoryImportService } from './history/history-import.service';

export const DIRECT_PERMISSIONS = ['read_messages', 'reply_to_customers'] as const;
export type DirectPermission = (typeof DIRECT_PERMISSIONS)[number];
export type PermissionSource = 'admin' | 'claude';

export interface DirectPermissionState {
  allowed: boolean;
  /** ISO time it was granted; null while not allowed. */
  since: string | null;
  /** The owner has answered (yes or no) at least once: Claude asks once. */
  decided: boolean;
}

export type DirectPermissions = Record<DirectPermission, DirectPermissionState>;

const COLUMN: Record<DirectPermission, string> = {
  read_messages: 'direct_read_allowed_at',
  reply_to_customers: 'direct_reply_allowed_at',
};

/** The mode each permission is needed for: withdrawing it pauses a store in that mode. */
const NEEDED_BY: Record<DirectPermission, 'learning' | 'active'> = {
  read_messages: 'learning',
  reply_to_customers: 'active',
};

/**
 * The owner's two permissions for the store's Instagram Direct, independent of
 * each other (`tenant_settings.direct_*_allowed_at`):
 *
 * - `read_messages`: DirectMate may read the Direct: the one-time history
 *   import and learning mode.
 * - `reply_to_customers`: the AI agent may answer customers: active mode and
 *   private replies to comments.
 *
 * With neither, incoming DMs aren't kept (`InstagramService.ingest`). The only
 * writer of the flags: the admin (Instagram step, launch, Settings) and the
 * Claude connector both come here. Every answer is logged in
 * `direct_permission_events`, a «no» too.
 *
 * The history import keeps its own copy of the read permission
 * (`tenant_onboarding.history_import.consent`), which its queue and worker
 * check between calls; it is written here, together with the flag.
 */
@Injectable()
export class DirectPermissionsService {
  private readonly logger = new Logger(DirectPermissionsService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly history: HistoryImportService,
  ) {}

  async get(tenantId: string): Promise<DirectPermissions> {
    const [row]: Array<{
      read_at: Date | null;
      reply_at: Date | null;
      read_decided: boolean;
      reply_decided: boolean;
    }> = await this.dataSource.query(
      `SELECT s.direct_read_allowed_at AS read_at, s.direct_reply_allowed_at AS reply_at,
              EXISTS (SELECT 1 FROM direct_permission_events e WHERE e.tenant_id = t.id AND e.permission = 'read_messages') AS read_decided,
              EXISTS (SELECT 1 FROM direct_permission_events e WHERE e.tenant_id = t.id AND e.permission = 'reply_to_customers') AS reply_decided
         FROM tenants t
         LEFT JOIN tenant_settings s ON s.tenant_id = t.id
        WHERE t.id = $1`,
      [tenantId],
    );
    const state = (at: Date | null | undefined, decided: boolean | undefined): DirectPermissionState => ({
      allowed: !!at,
      since: at ? new Date(at).toISOString() : null,
      decided: !!decided,
    });
    return {
      read_messages: state(row?.read_at, row?.read_decided),
      reply_to_customers: state(row?.reply_at, row?.reply_decided),
    };
  }

  /**
   * Grant or withdraw one permission; the other is never touched. A grant
   * keeps the time it was first given. Withdrawing what the store's mode needs
   * pauses the store (`operatingMode` in the result). Granting read queues the
   * history import when Instagram is connected; withdrawing it stops a running
   * import and deletes what was learned.
   */
  async set(
    tenantId: string,
    permission: DirectPermission,
    allowed: boolean,
    by: { source: PermissionSource; userId?: string | null },
  ): Promise<{ permissions: DirectPermissions; operatingMode?: 'paused' }> {
    const column = COLUMN[permission];
    await this.dataSource.query(
      `INSERT INTO tenant_settings (tenant_id, ${column}) VALUES ($1, CASE WHEN $2::boolean THEN now() END)
       ON CONFLICT (tenant_id) DO UPDATE
         SET ${column} = CASE WHEN $2::boolean THEN coalesce(tenant_settings.${column}, now()) END,
             updated_at = now()`,
      [tenantId, allowed],
    );
    await this.dataSource.query(
      `INSERT INTO direct_permission_events (tenant_id, permission, allowed, source, user_id) VALUES ($1, $2, $3, $4, $5)`,
      [tenantId, permission, allowed, by.source, by.userId ?? null],
    );

    if (permission === 'read_messages') {
      await this.history.setConsent(tenantId, allowed);
      // Queued at once when Instagram is connected; otherwise the queue picks it up once it is.
      if (allowed) await this.history.request(tenantId).catch(() => undefined);
    }

    let operatingMode: 'paused' | undefined;
    if (!allowed) {
      const paused = returnedRows<{ tenant_id: string }>(
        await this.dataSource.query(
          `UPDATE store_configs SET operating_mode = 'paused', updated_at = now()
            WHERE tenant_id = $1 AND operating_mode = $2 RETURNING tenant_id`,
          [tenantId, NEEDED_BY[permission]],
        ),
      );
      if (paused.length > 0) operatingMode = 'paused';
    }
    this.logger.log(
      `${tenantId}: ${permission} ${allowed ? 'allowed' : 'not allowed'} (${by.source})${operatingMode ? ', store paused' : ''}`,
    );
    return { permissions: await this.get(tenantId), ...(operatingMode && { operatingMode }) };
  }
}
