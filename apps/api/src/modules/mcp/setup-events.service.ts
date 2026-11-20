import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

export type SetupStep = 'authorized' | 'catalog_connected' | 'instagram_connected' | 'first_try_agent' | 'go_live';

/** The funnel of stores set up through Claude: the first time each store reaches each step. */
@Injectable()
export class SetupEventsService {
  private readonly logger = new Logger(SetupEventsService.name);

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /** Never fails the caller: a lost funnel row must not break a setup step. */
  async record(tenantId: string, step: SetupStep, source = 'claude'): Promise<void> {
    await this.dataSource
      .query(
        `INSERT INTO setup_events (tenant_id, source, step) VALUES ($1, $2, $3)
         ON CONFLICT (tenant_id, source, step) DO NOTHING`,
        [tenantId, source, step],
      )
      .catch((err) => this.logger.warn(`Setup event ${step} not recorded for ${tenantId}: ${(err as Error).message}`));
  }
}
