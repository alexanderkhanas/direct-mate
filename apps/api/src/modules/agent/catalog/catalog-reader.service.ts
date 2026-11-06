import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AvailabilityService } from '../../availability/availability.service';
import { effectivePrice, regularPriceIfDiscounted } from '../../../common/pricing';
import type { ProductAttributes } from '../../catalog/attributes/product-attributes';

/** The catalog index's heading for products without a category. */
export const NO_CATEGORY = 'Інше';

/**
 * Product refs: the first 8 hex characters of the product's UUID. The catalog
 * index and every tool use them instead of full UUIDs — about 20 fewer tokens
 * per product in the prompt, and nothing for the model to mangle. Resolution is
 * always by tenant, so a ref can only ever reach this store's catalog.
 */
export function productRef(productId: string): string {
  return productId.slice(0, 8);
}

const REF_PATTERN = /^[0-9a-f]{8}[0-9a-f-]{0,28}$/;

export interface AgentVariant {
  id: string;
  color: string | null;
  size: string | null;
  /** What the customer pays (sale price when lower). */
  price: number;
  /** Regular price when discounted, else null. */
  regularPrice: number | null;
  currency: string;
  available: number;
  imageUrl: string | null;
}

export interface AgentProduct {
  id: string;
  ref: string;
  title: string;
  category: string | null;
  brand: string | null;
  material: string | null;
  gender: string | null;
  season: string | null;
  modelName: string | null;
  description: string | null;
  imageUrl: string | null;
  /** Visual attributes (catalog/attributes); empty until read from the photo. */
  attributes: ProductAttributes;
  variants: AgentVariant[];
}

export type RefResolution = { id: string } | { error: string };

export interface CategoryCount {
  name: string;
  products: number;
}

interface CategoryRow {
  product_id: string;
  title: string;
  category: string | null;
  attributes: ProductAttributes | null;
  variant_id: string;
  color: string | null;
  size: string | null;
  price: string;
  sale_price: string | null;
  currency: string;
  available: string;
}

/** Catalog reads for the agent's tools. Every method takes the tenant. */
@Injectable()
export class CatalogReader {
  constructor(
    private readonly dataSource: DataSource,
    private readonly availability: AvailabilityService,
  ) {}

  async resolveProductRef(tenantId: string, ref: string): Promise<RefResolution> {
    const clean = String(ref ?? '').trim().toLowerCase();
    if (!REF_PATTERN.test(clean)) {
      return { error: `"${ref}" is not a product ref from the catalog list.` };
    }
    const rows: Array<{ id: string }> = await this.dataSource.query(
      `SELECT id FROM products
        WHERE tenant_id = $1 AND status = 'active' AND id::text LIKE $2
        LIMIT 2`,
      [tenantId, `${clean}%`],
    );
    if (rows.length === 0) return { error: `No product with ref "${ref}" in this store.` };
    if (rows.length > 1) return { error: `Ref "${ref}" matches more than one product; use a longer ref.` };
    return { id: rows[0].id };
  }

  /**
   * Full variant matrix with live stock and images, in the order given. Ids
   * from another tenant are silently dropped.
   */
  async loadProducts(tenantId: string, productIds: string[]): Promise<AgentProduct[]> {
    if (productIds.length === 0) return [];
    const [grouped, attributes] = await Promise.all([
      this.availability.findAllByProductIds(productIds, { tenantId }),
      this.dataSource.query(
        `SELECT id, brand, material, gender, season, model_name, description, attributes
           FROM products WHERE tenant_id = $1 AND id = ANY($2)`,
        [tenantId, productIds],
      ) as Promise<
        Array<{
          id: string;
          brand: string | null;
          material: string | null;
          gender: string | null;
          season: string | null;
          model_name: string | null;
          description: string | null;
          attributes: ProductAttributes | null;
        }>
      >,
    ]);
    const attrsById = new Map(attributes.map((a) => [a.id, a]));

    return grouped
      .filter((g) => attrsById.has(g.product.id))
      .map((g) => {
        const a = attrsById.get(g.product.id)!;
        return {
          id: g.product.id,
          ref: productRef(g.product.id),
          title: g.product.title,
          category: g.product.category ?? null,
          brand: a.brand,
          material: a.material,
          gender: a.gender,
          season: a.season,
          modelName: a.model_name,
          description: a.description,
          imageUrl: g.product.imageUrl ?? null,
          attributes: a.attributes ?? {},
          variants: g.variants.map((v) => ({
            id: v.id,
            color: v.color,
            size: v.size,
            price: effectivePrice(v.price, v.salePrice),
            regularPrice: regularPriceIfDiscounted(v.price, v.salePrice),
            currency: v.currency,
            available: v.effectiveAvailable,
            imageUrl: v.imageUrl,
          })),
        };
      });
  }

  /** The store's categories as the catalog index names them, with product counts. */
  async listCategories(tenantId: string): Promise<CategoryCount[]> {
    const rows: Array<{ name: string; products: string }> = await this.dataSource.query(
      `SELECT COALESCE(NULLIF(TRIM(category), ''), $2) AS name, COUNT(*) AS products
         FROM products WHERE tenant_id = $1 AND status = 'active'
        GROUP BY 1 ORDER BY 1`,
      [tenantId, NO_CATEGORY],
    );
    return rows.map((r) => ({ name: r.name, products: Number(r.products) }));
  }

  /**
   * Every active product in one category with live stock and prices, in one
   * query — `loadProducts` hydrates at most 25 products, and a category is the
   * whole list. Light rows: no description or images (`get_product` has
   * those).
   */
  async loadCategory(tenantId: string, category: string): Promise<AgentProduct[]> {
    const rows: CategoryRow[] = await this.dataSource.query(
      `SELECT p.id AS product_id, p.title, p.category, p.attributes,
              v.id AS variant_id, v.color, v.size, v.price, v.sale_price, v.currency,
              (SELECT COALESCE(SUM(sb.available_qty - sb.reserved_qty - sb.pending_checkout_qty), 0)
                 FROM stock_balances sb WHERE sb.variant_id = v.id) AS available
         FROM products p
         JOIN product_variants v ON v.product_id = p.id AND v.active = true
        WHERE p.tenant_id = $1 AND p.status = 'active'
          AND COALESCE(NULLIF(TRIM(p.category), ''), $3) ILIKE $2
        ORDER BY p.title, p.id, v.id`,
      [tenantId, category.replace(/[\\%_]/g, '\\$&'), NO_CATEGORY],
    );

    const products = new Map<string, AgentProduct>();
    for (const r of rows) {
      let product = products.get(r.product_id);
      if (!product) {
        product = {
          id: r.product_id,
          ref: productRef(r.product_id),
          title: r.title,
          category: r.category,
          brand: null,
          material: null,
          gender: null,
          season: null,
          modelName: null,
          description: null,
          imageUrl: null,
          attributes: r.attributes ?? {},
          variants: [],
        };
        products.set(r.product_id, product);
      }
      const price = Number(r.price);
      const salePrice = r.sale_price != null ? Number(r.sale_price) : null;
      product.variants.push({
        id: r.variant_id,
        color: r.color,
        size: r.size,
        price: effectivePrice(price, salePrice),
        regularPrice: regularPriceIfDiscounted(price, salePrice),
        currency: r.currency,
        available: Number(r.available),
        imageUrl: null,
      });
    }
    return [...products.values()];
  }
}
