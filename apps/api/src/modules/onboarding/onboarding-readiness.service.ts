import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

/** What must be in place before a store's bot may answer customers. */
export type GoLiveRequirement = 'instagram' | 'products' | 'knowledge';

export interface Readiness {
  ready: boolean;
  missing: GoLiveRequirement[];
}

/**
 * Read from the store's real data, not from flags, so it can't drift: an
 * Instagram connection, at least one product a customer could buy, and the
 * store notes the agent answers delivery and payment questions from.
 */
@Injectable()
export class OnboardingReadiness {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async check(tenantId: string): Promise<Readiness> {
    const [row]: Array<{ instagram: boolean; products: boolean; knowledge: boolean }> = await this.dataSource.query(
      `SELECT
         EXISTS (SELECT 1 FROM connections
                  WHERE tenant_id = $1 AND type = 'instagram' AND status = 'connected') AS instagram,
         EXISTS (SELECT 1 FROM products p
                   JOIN product_variants v ON v.product_id = p.id AND v.active = true
                   JOIN stock_balances sb ON sb.variant_id = v.id
                  WHERE p.tenant_id = $1 AND p.status = 'active'
                    AND sb.available_qty - sb.reserved_qty - sb.pending_checkout_qty > 0) AS products,
         EXISTS (SELECT 1 FROM store_configs
                  WHERE tenant_id = $1 AND length(btrim(coalesce(knowledge_doc, ''))) > 0) AS knowledge`,
      [tenantId],
    );
    const missing = (['instagram', 'products', 'knowledge'] as const).filter((k) => !row?.[k]);
    return { ready: missing.length === 0, missing };
  }
}
