import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { returnedRows } from '../../../common/db';

/** How a link was found. */
export type LinkSource = 'manual' | 'caption_sku' | 'same_image' | 'conversation' | 'vision';
/** `confirmed`: the AI agent offers it alone. `suggested`: evidence only. `rejected`: the owner said no. */
export type LinkStatus = 'suggested' | 'confirmed' | 'rejected';

export interface LinkEvidence {
  /** Customers who chose it from this content; `orderId` when they ordered it. */
  picks?: Array<{ conversationId: string; orderId?: string }>;
  /** The visual check's one-line reason. */
  reason?: string;
}

export interface ContentLink {
  id: string;
  mappingId: string;
  productId: string;
  title: string;
  color: string | null;
  source: LinkSource;
  status: LinkStatus;
  confidence: number | null;
  evidence: LinkEvidence;
}

/** A link as the Content page shows it: with the product's picture in that colour. */
export interface ContentLinkView extends ContentLink {
  imageUrl: string | null;
}

/** Which content row: ours (`mappingId`) or Instagram's media id. */
export type LinkTarget = { mappingId: string } | { mediaId: string };

interface LinkRow {
  id: string;
  mapping_id: string;
  product_id: string;
  title: string;
  color: string | null;
  source: LinkSource;
  status: LinkStatus;
  confidence: number | null;
  evidence: LinkEvidence | null;
  image_url?: string | null;
}

const toLink = (r: LinkRow): ContentLink => ({
  id: r.id,
  mappingId: r.mapping_id,
  productId: r.product_id,
  title: r.title,
  color: r.color,
  source: r.source,
  status: r.status,
  confidence: r.confidence,
  evidence: r.evidence ?? {},
});

/**
 * The products a story, post or reel shows (`content_products`), several per
 * piece of content. The only writer of links.
 *
 * - Only the owner, a caption SKU or the same image makes a link certain.
 * - Code never overrides the owner: a pair they rejected stays rejected, one
 *   they confirmed stays confirmed.
 * - Every write joins the content row and the product on the tenant, so an id
 *   from another store links nothing.
 */
@Injectable()
export class ContentLinksService {
  constructor(private readonly dataSource: DataSource) {}

  /** What the AI agent may use for one piece of content: confirmed first, rejected left out. */
  async forMedia(tenantId: string, mediaId: string): Promise<ContentLink[]> {
    const rows: LinkRow[] = await this.dataSource.query(
      `SELECT cp.*, p.title
         FROM content_products cp
         JOIN instagram_media_mappings m ON m.id = cp.mapping_id
         JOIN products p ON p.id = cp.product_id
        WHERE cp.tenant_id = $1 AND m.instagram_media_id = $2 AND cp.status <> 'rejected'
        ORDER BY (cp.status = 'confirmed') DESC, cp.created_at`,
      [tenantId, mediaId],
    );
    return rows.map(toLink);
  }

  /** The Content page: each row's links (rejected left out), with the product's picture in the linked colour. */
  async forMappings(tenantId: string, mappingIds: string[]): Promise<Map<string, ContentLinkView[]>> {
    const byMapping = new Map<string, ContentLinkView[]>();
    if (mappingIds.length === 0) return byMapping;
    const rows: LinkRow[] = await this.dataSource.query(
      `SELECT cp.*, p.title,
              (SELECT pm.url FROM product_media pm
                WHERE pm.product_id = cp.product_id
                ORDER BY (lower(pm.color) IS NOT DISTINCT FROM lower(cp.color)) DESC, pm.sort_order
                LIMIT 1) AS image_url
         FROM content_products cp
         JOIN products p ON p.id = cp.product_id
        WHERE cp.tenant_id = $1 AND cp.mapping_id = ANY($2::uuid[]) AND cp.status <> 'rejected'
        ORDER BY (cp.status = 'confirmed') DESC, cp.created_at`,
      [tenantId, mappingIds],
    );
    for (const r of rows) {
      const list = byMapping.get(r.mapping_id) ?? [];
      list.push({ ...toLink(r), imageUrl: r.image_url ?? null });
      byMapping.set(r.mapping_id, list);
    }
    return byMapping;
  }

  /**
   * A link code found (caption SKU, the same image) or evidence for one
   * (customers, the visual check). A certain one upgrades a suggestion; neither
   * touches a pair the owner confirmed or rejected. True when it added or
   * upgraded a link.
   */
  async autoLink(
    tenantId: string,
    target: LinkTarget,
    link: {
      productId: string;
      color: string | null;
      source: Exclude<LinkSource, 'manual'>;
      status: Exclude<LinkStatus, 'rejected'>;
      confidence?: number | null;
      evidence?: LinkEvidence;
    },
  ): Promise<boolean> {
    const [where, key] = 'mappingId' in target ? ['m.id = $2::uuid', target.mappingId] : ['m.instagram_media_id = $2', target.mediaId];
    const rows = returnedRows<{ id: string }>(
      await this.dataSource.query(
        `INSERT INTO content_products (tenant_id, mapping_id, product_id, color, source, status, confidence, evidence)
         SELECT $1::uuid, m.id, p.id, $4::text, $5::text, $6::text, $7::real, $8::jsonb
           FROM instagram_media_mappings m
           JOIN products p ON p.id = $3 AND p.tenant_id = $1
          WHERE m.tenant_id = $1 AND ${where}
         ON CONFLICT (mapping_id, product_id, (coalesce(color, ''))) DO UPDATE SET
           status = EXCLUDED.status,
           source = CASE WHEN EXCLUDED.status = 'confirmed' THEN EXCLUDED.source ELSE content_products.source END,
           confidence = coalesce(EXCLUDED.confidence, content_products.confidence),
           updated_at = now()
         WHERE content_products.status = 'suggested'
           AND (EXCLUDED.status = 'confirmed' OR EXCLUDED.confidence IS DISTINCT FROM content_products.confidence)
         RETURNING id`,
        [
          tenantId,
          key,
          link.productId,
          link.color,
          link.source,
          link.status,
          link.confidence ?? null,
          JSON.stringify(link.evidence ?? {}),
        ],
      ),
    );
    return rows.length > 0;
  }

  /**
   * The owner links a product to a content row: confirmed, even over a
   * rejection. Confirming a suggestion keeps where it came from. Null when the
   * row or the product isn't this store's.
   */
  async ownerLink(tenantId: string, mappingId: string, productId: string, color: string | null): Promise<string | null> {
    const rows = returnedRows<{ id: string }>(
      await this.dataSource.query(
        `INSERT INTO content_products (tenant_id, mapping_id, product_id, color, source, status)
         SELECT $1::uuid, m.id, p.id, $4::text, 'manual', 'confirmed'
           FROM instagram_media_mappings m
           JOIN products p ON p.id = $3 AND p.tenant_id = $1
          WHERE m.tenant_id = $1 AND m.id = $2::uuid
         ON CONFLICT (mapping_id, product_id, (coalesce(color, ''))) DO UPDATE SET
           status = 'confirmed',
           source = CASE WHEN content_products.status = 'rejected' THEN 'manual' ELSE content_products.source END,
           updated_at = now()
         RETURNING id`,
        [tenantId, mappingId, productId, color],
      ),
    );
    return rows[0]?.id ?? null;
  }

  /**
   * A customer chose this product as the item shown in the content they
   * pointed at: evidence on a suggestion (created if needed), once per
   * conversation. Never touches a rejected pair; a confirmed one only gains the
   * evidence. True when the evidence was added.
   */
  async addPick(
    tenantId: string,
    target: LinkTarget,
    pick: { productId: string; color: string | null; conversationId: string },
  ): Promise<boolean> {
    const [where, key] = 'mappingId' in target ? ['m.id = $2::uuid', target.mappingId] : ['m.instagram_media_id = $2', target.mediaId];
    const rows = returnedRows<{ id: string }>(
      await this.dataSource.query(
        `INSERT INTO content_products (tenant_id, mapping_id, product_id, color, source, status, evidence)
         SELECT $1::uuid, m.id, p.id, $4::text, 'conversation', 'suggested',
                jsonb_build_object('picks', jsonb_build_array(jsonb_build_object('conversationId', $5::text)))
           FROM instagram_media_mappings m
           JOIN products p ON p.id = $3 AND p.tenant_id = $1
          WHERE m.tenant_id = $1 AND ${where}
         ON CONFLICT (mapping_id, product_id, (coalesce(color, ''))) DO UPDATE SET
           evidence = jsonb_set(
             content_products.evidence, '{picks}',
             coalesce(content_products.evidence->'picks', '[]'::jsonb)
               || jsonb_build_array(jsonb_build_object('conversationId', $5::text))
           ),
           updated_at = now()
         WHERE content_products.status <> 'rejected'
           AND NOT coalesce(content_products.evidence->'picks', '[]'::jsonb)
                   @> jsonb_build_array(jsonb_build_object('conversationId', $5::text))
         RETURNING id`,
        [tenantId, key, pick.productId, pick.color, pick.conversationId],
      ),
    );
    return rows.length > 0;
  }

  /**
   * The order a conversation placed: on each link that conversation picked
   * and the order contains, the pick gains the order id. Returns the links
   * that changed, so the caller can ask the owner about a suggestion.
   */
  async addOrder(
    tenantId: string,
    conversationId: string,
    order: { orderId: string; checkoutSessionId: string },
  ): Promise<Array<{ id: string; status: LinkStatus; ownerAskedAt: Date | null }>> {
    const rows = returnedRows<{ id: string; status: LinkStatus; owner_asked_at: Date | null }>(
      await this.dataSource.query(
        `UPDATE content_products cp
            SET evidence = jsonb_set(cp.evidence, '{picks}', (
                  SELECT jsonb_agg(CASE WHEN pick->>'conversationId' = $2 AND pick->>'orderId' IS NULL
                                        THEN pick || jsonb_build_object('orderId', $3::text) ELSE pick END)
                    FROM jsonb_array_elements(cp.evidence->'picks') AS pick)),
                updated_at = now()
          WHERE cp.tenant_id = $1
            AND cp.status <> 'rejected'
            AND cp.product_id IN (SELECT ci.product_id FROM checkout_items ci WHERE ci.checkout_session_id = $4::uuid)
            AND cp.evidence->'picks' @> jsonb_build_array(jsonb_build_object('conversationId', $2::text))
            AND NOT cp.evidence->'picks' @> jsonb_build_array(jsonb_build_object('conversationId', $2::text, 'orderId', $3::text))
          RETURNING cp.id, cp.status, cp.owner_asked_at`,
        [tenantId, conversationId, order.orderId, order.checkoutSessionId],
      ),
    );
    return rows.map((r) => ({ id: r.id, status: r.status, ownerAskedAt: r.owner_asked_at }));
  }

  /** The link for this content row, product and colour, if there is one. */
  async findId(tenantId: string, mappingId: string, productId: string, color: string | null): Promise<string | null> {
    const [row]: Array<{ id: string }> = await this.dataSource.query(
      `SELECT id FROM content_products
        WHERE tenant_id = $1 AND mapping_id = $2 AND product_id = $3 AND coalesce(color, '') = coalesce($4::text, '')`,
      [tenantId, mappingId, productId, color],
    );
    return row?.id ?? null;
  }

  /** The owner confirms or rejects a link. False when it isn't this store's. */
  async setStatus(tenantId: string, linkId: string, status: 'confirmed' | 'rejected'): Promise<boolean> {
    const rows = returnedRows<{ id: string }>(
      await this.dataSource.query(
        `UPDATE content_products SET status = $3, updated_at = now() WHERE id = $1 AND tenant_id = $2 RETURNING id`,
        [linkId, tenantId, status],
      ),
    );
    return rows.length > 0;
  }
}
