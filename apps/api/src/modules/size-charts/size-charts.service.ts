import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { DataSource, Repository } from 'typeorm';
import * as fs from 'fs/promises';
import * as path from 'path';
import { SizeChart } from './size-chart.entity';
import { lowerTrim, lowerTrimArray } from './normalize';
import { chartCovers, pickChart, type ProductScope } from './chart-scope';
import { pruneUncertain, readyProblems, sizeChartTableSchema } from './table-schema';
import type { SizeChartTable } from './size-chart-table';

interface CreateSizeChartDto {
  name: string;
  imagePath: string;
  categories?: string[];
  brands?: string[];
  isDefault?: boolean;
}

export interface UpdateSizeChartDto {
  name?: string;
  imagePath?: string;
  categories?: string[];
  brands?: string[];
  isDefault?: boolean;
  /** Validated here (`sizeChartTableSchema`); the admin sends what the owner checked. */
  table?: unknown;
  status?: 'draft' | 'ready';
  sendImage?: boolean;
}

/** Which products a chart is for, as the admin chooses them. Empty = all. */
export interface ScopeFilter {
  brands: string[];
  categories: string[];
}

/** Products with no ready chart, for «Ще N товарів без сітки: штани, топи…». */
export interface SizeChartCoverage {
  total: number;
  covered: number;
  uncovered: number;
  /** Brands none of whose products has a chart, most products first. */
  uncoveredBrands: string[];
  /** Categories none of whose products has a chart, most products first. */
  uncoveredCategories: string[];
}

export type SizeChartWithCount = SizeChart & { productCount: number };

interface ProductScopeRow {
  id: string;
  brand: string | null;
  category: string | null;
  linked: string[] | null;
}

type ScopedProduct = ProductScope & { id: string };

/** A scope as stored on a chart: lower-case, trimmed, no blanks. */
const asScope = (filter: ScopeFilter) => ({
  brands: lowerTrimArray(filter.brands),
  categories: lowerTrimArray(filter.categories),
  isDefault: false,
  createdAt: new Date(0),
});

@Injectable()
export class SizeChartsService {
  private readonly logger = new Logger(SizeChartsService.name);

  constructor(
    @InjectRepository(SizeChart)
    private readonly repo: Repository<SizeChart>,
    private readonly dataSource: DataSource,
    private readonly config: ConfigService,
  ) {}

  async listForTenant(tenantId: string): Promise<SizeChart[]> {
    return this.repo.find({
      where: { tenantId },
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * The charts with how many active products each one is the chart for (GET
   * /size-charts): a product counts for the most specific chart covering it.
   */
  async listWithCounts(tenantId: string): Promise<SizeChartWithCount[]> {
    const [charts, products] = await Promise.all([this.listForTenant(tenantId), this.productScopes(tenantId)]);
    const counts = new Map<string, number>();
    for (const p of products) {
      const picked = pickChart(charts, p);
      if (picked) counts.set(picked.id, (counts.get(picked.id) ?? 0) + 1);
    }
    return charts.map((chart) => Object.assign(chart, { productCount: counts.get(chart.id) ?? 0 }));
  }

  async get(tenantId: string, id: string): Promise<SizeChart> {
    const chart = await this.repo.findOne({ where: { id, tenantId } });
    if (!chart) throw new NotFoundException('Size chart not found');
    return chart;
  }

  async create(tenantId: string, dto: CreateSizeChartDto): Promise<SizeChart> {
    checkImagePath(dto.imagePath);
    const brands = lowerTrimArray(dto.brands);
    const categories = lowerTrimArray(dto.categories);

    return this.dataSource.transaction(async (manager) => {
      if (dto.isDefault) {
        await manager
          .getRepository(SizeChart)
          .update({ tenantId, isDefault: true }, { isDefault: false });
      }
      const entity = manager.getRepository(SizeChart).create({
        tenantId,
        name: dto.name.trim(),
        imagePath: dto.imagePath,
        brands,
        categories,
        isDefault: !!dto.isDefault,
      });
      return manager.getRepository(SizeChart).save(entity);
    });
  }

  /**
   * A new image makes the old table meaningless, so it is cleared (status
   * back to `image`) unless a table comes with it. A chart is `ready` only
   * with a table that has sizes and measurements, checked whenever the
   * status or the table of a ready chart changes; the owner checked it, so
   * `uncertain` is cleared.
   */
  async update(
    tenantId: string,
    id: string,
    dto: UpdateSizeChartDto,
  ): Promise<SizeChart> {
    const existing = await this.get(tenantId, id);

    const table = dto.table !== undefined ? validTable(dto.table) : undefined;
    if (dto.status !== undefined && dto.status !== 'draft' && dto.status !== 'ready') {
      throw new BadRequestException('status must be draft or ready');
    }
    if (dto.imagePath !== undefined) checkImagePath(dto.imagePath);

    return this.dataSource.transaction(async (manager) => {
      if (dto.isDefault === true && !existing.isDefault) {
        await manager
          .getRepository(SizeChart)
          .update({ tenantId, isDefault: true }, { isDefault: false });
      }
      if (dto.name !== undefined) existing.name = dto.name.trim();
      if (dto.imagePath !== undefined && dto.imagePath !== existing.imagePath) {
        existing.imagePath = dto.imagePath;
        if (!table) {
          existing.table = null;
          existing.status = 'image';
        }
      }
      if (dto.brands !== undefined) existing.brands = lowerTrimArray(dto.brands);
      if (dto.categories !== undefined)
        existing.categories = lowerTrimArray(dto.categories);
      if (dto.isDefault !== undefined) existing.isDefault = !!dto.isDefault;
      if (dto.sendImage !== undefined) existing.sendImage = !!dto.sendImage;
      if (table) existing.table = table;

      const status = dto.status ?? (table && existing.status === 'image' ? 'draft' : existing.status);
      if (status !== 'image' && !existing.table) {
        throw new BadRequestException({ message: 'The chart has not been read yet', details: { reason: 'not_ready' } });
      }
      if (status === 'ready' && (dto.status === 'ready' || table)) {
        const problems = readyProblems(existing.table!);
        if (problems.length > 0) {
          throw new BadRequestException({ message: problems.join('. '), details: { reason: 'not_ready', issues: problems } });
        }
        existing.table = { ...existing.table!, uncertain: [] };
      }
      existing.status = status;
      return manager.getRepository(SizeChart).save(existing);
    });
  }

  /**
   * A chart that is only a table, read in the Claude chat: no picture, so
   * nothing is sent to customers (`sendImage` false). Checked like a table the
   * admin saves; `ready` clears `uncertain`, since the owner confirmed it.
   */
  async createFromTable(
    tenantId: string,
    dto: { name: string; brands?: string[]; categories?: string[]; table: unknown; status: 'draft' | 'ready' },
  ): Promise<SizeChart> {
    let table = validTable(dto.table);
    if (dto.status === 'ready') {
      const problems = readyProblems(table);
      if (problems.length > 0) {
        throw new BadRequestException({ message: problems.join('. '), details: { reason: 'not_ready', issues: problems } });
      }
      table = { ...table, uncertain: [] };
    }
    return this.repo.save(
      this.repo.create({
        tenantId,
        name: dto.name.trim(),
        imagePath: null,
        brands: lowerTrimArray(dto.brands),
        categories: lowerTrimArray(dto.categories),
        isDefault: false,
        table,
        status: dto.status,
        sendImage: false,
      }),
    );
  }

  async delete(tenantId: string, id: string): Promise<void> {
    const existing = await this.get(tenantId, id);
    await this.repo.delete({ id, tenantId });
    if (!existing.imagePath) return;
    // Best-effort unlink — orphaned files are cleaned by the nightly sweep.
    const uploadsDir = path.join(process.cwd(), 'uploads');
    const fileBasename = path.basename(existing.imagePath);
    const abs = path.join(uploadsDir, fileBasename);
    try {
      await fs.unlink(abs);
    } catch (err) {
      this.logger.warn(`Could not unlink ${abs}: ${(err as Error).message}`);
    }
  }

  /**
   * Brands of the store's active products, for the scope chips. Spelled as
   * the catalog has them; one entry per brand however it is cased.
   */
  async listTenantBrands(tenantId: string): Promise<string[]> {
    const rows: Array<{ name: string }> = await this.dataSource.query(
      `SELECT DISTINCT ON (lower(trim(brand))) trim(brand) AS name
         FROM products
        WHERE tenant_id = $1 AND status = 'active' AND brand IS NOT NULL AND trim(brand) <> ''
        ORDER BY lower(trim(brand)), brand`,
      [tenantId],
    );
    return rows.map((r) => r.name);
  }

  /** Categories of the store's active products: `products.category` and the linked `categories`. */
  async listTenantCategories(tenantId: string): Promise<string[]> {
    const rows: Array<{ name: string }> = await this.dataSource.query(
      `SELECT DISTINCT ON (lower(name)) name FROM (
         SELECT trim(p.category) AS name
           FROM products p
          WHERE p.tenant_id = $1 AND p.status = 'active' AND p.category IS NOT NULL AND trim(p.category) <> ''
         UNION ALL
         SELECT trim(c.name)
           FROM products p
           JOIN product_categories pc ON pc.product_id = p.id
           JOIN categories c ON c.id = pc.category_id
          WHERE p.tenant_id = $1 AND p.status = 'active' AND trim(c.name) <> ''
       ) names
       ORDER BY lower(name), name`,
      [tenantId],
    );
    return rows.map((r) => r.name);
  }

  /** How many active products a scope covers, out of all of them (the live count on the scope screen). */
  async matchCount(tenantId: string, filter: ScopeFilter): Promise<{ count: number; total: number }> {
    const products = await this.productScopes(tenantId);
    const scope = asScope(filter);
    return { count: products.filter((p) => chartCovers(scope, p)).length, total: products.length };
  }

  /**
   * Active products whose chart is `ready`, and the rest. A product's chart
   * is the most specific one covering it, whatever its status; only a ready
   * one gives a recommendation, so a product whose own chart is a picture or
   * unchecked isn't covered even when a broader ready chart exists.
   */
  async coverage(tenantId: string): Promise<SizeChartCoverage> {
    const [products, charts] = await Promise.all([this.productScopes(tenantId), this.repo.find({ where: { tenantId } })]);
    const isCovered = new Map(products.map((p) => [p.id, pickChart(charts, p)?.status === 'ready']));
    const covered = products.filter((p) => isCovered.get(p.id)).length;
    return {
      total: products.length,
      covered,
      uncovered: products.length - covered,
      uncoveredBrands: whollyUncovered(products, isCovered, (p) => (p.brand?.trim() ? [p.brand.trim()] : [])),
      uncoveredCategories: whollyUncovered(products, isCovered, (p) => p.categories),
    };
  }

  /** The sizes of the active products a chart covers, for reading the chart in the shop's size system. */
  async sizesInScope(tenantId: string, id: string): Promise<string[]> {
    const chart = await this.get(tenantId, id);
    return this.sizesFor(tenantId, chart);
  }

  /** The sizes of the active products a scope covers (empty lists = every product). */
  async sizesFor(tenantId: string, filter: ScopeFilter): Promise<string[]> {
    const scope = asScope(filter);
    const ids = (await this.productScopes(tenantId)).filter((p) => chartCovers(scope, p)).map((p) => p.id);
    if (ids.length === 0) return [];
    const rows: Array<{ size: string }> = await this.dataSource.query(
      `SELECT DISTINCT trim(size) AS size FROM product_variants
        WHERE product_id = ANY($1) AND active = true AND size IS NOT NULL AND trim(size) <> ''
        LIMIT 200`,
      [ids],
    );
    return rows.map((r) => r.size);
  }

  /**
   * The chart for a product: the most specific one covering it, whatever its
   * status (see `pickChart`). Pass `productId`, or a brand and categories.
   * The bot recommends a size from it only when it is `ready`; a broader
   * ready chart never stands in for it.
   */
  async resolveForContext(
    tenantId: string,
    ctx: { productId?: string; brand?: string | null; categories?: string[] },
  ): Promise<SizeChart | null> {
    const [charts, product] = await Promise.all([
      this.repo.find({ where: { tenantId } }),
      ctx.productId
        ? this.productScopes(tenantId, ctx.productId).then((rows) => rows[0] ?? null)
        : Promise.resolve<ProductScope>({ brand: ctx.brand ?? null, categories: ctx.categories ?? [] }),
    ]);
    return product ? pickChart(charts, product) : null;
  }

  /**
   * Builds a publicly reachable HTTPS URL for Meta to fetch.
   * In prod APP_BASE_URL must be the public domain; in dev it should be the ngrok URL.
   */
  publicUrl(imagePath: string): string {
    const base = (this.config.get<string>('app.baseUrl') ?? '').replace(/\/$/, '');
    const clean = imagePath.replace(/^\//, '');
    return `${base}/${clean}`;
  }

  /**
   * Each product's brand and categories (`products.category` plus the
   * `product_categories` names). Every active product, or the one asked for
   * whatever its status.
   */
  private async productScopes(tenantId: string, productId?: string): Promise<ScopedProduct[]> {
    const rows: ProductScopeRow[] = await this.dataSource.query(
      `SELECT p.id, p.brand, p.category,
              array_agg(c.name) FILTER (WHERE c.name IS NOT NULL) AS linked
         FROM products p
         LEFT JOIN product_categories pc ON pc.product_id = p.id
         LEFT JOIN categories c ON c.id = pc.category_id
        WHERE p.tenant_id = $1 AND ${productId ? 'p.id = $2' : `p.status = 'active'`}
        GROUP BY p.id`,
      productId ? [tenantId, productId] : [tenantId],
    );
    return rows.map((r) => ({
      id: r.id,
      brand: r.brand,
      categories: [r.category, ...(r.linked ?? [])].filter((c): c is string => !!c && c.trim().length > 0),
    }));
  }
}

/** A table as the admin or Claude sends it, checked (`sizeChartTableSchema`), with stale `uncertain` entries dropped. */
function validTable(input: unknown): SizeChartTable {
  const parsed = sizeChartTableSchema.safeParse(input);
  if (!parsed.success) {
    throw new BadRequestException({
      message: 'The size chart table is not valid.',
      details: { reason: 'invalid_table', issues: parsed.error.issues.map((i) => i.message) },
    });
  }
  return pruneUncertain(parsed.data);
}

const UPLOADED_IMAGE = /^uploads\/[0-9a-f-]{36}\.(png|jpe?g|webp)$/i;

/**
 * A chart's picture is a file this API saved (POST /size-charts/upload) or
 * an https URL, never any other path: the reader sends it to the model.
 */
function checkImagePath(imagePath: string): void {
  if (UPLOADED_IMAGE.test(imagePath)) return;
  try {
    if (new URL(imagePath).protocol === 'https:') return;
  } catch {
    // Not a URL either.
  }
  throw new BadRequestException({ message: 'imagePath must be an uploaded image or an https URL', details: { reason: 'invalid_image' } });
}

/**
 * Names (brands or categories) where no product has a chart, most products
 * first, spelled as first seen. A brand partly covered isn't listed: «бренди
 * Linen Lab і Monte» names only what is missing entirely.
 */
function whollyUncovered(
  products: ScopedProduct[],
  isCovered: Map<string, boolean>,
  namesOf: (p: ScopedProduct) => string[],
): string[] {
  const groups = new Map<string, { name: string; count: number; covered: boolean }>();
  for (const p of products) {
    const names = new Map(namesOf(p).map((n) => [lowerTrim(n), n.trim()]));
    for (const [key, name] of names) {
      const group = groups.get(key) ?? { name, count: 0, covered: false };
      group.count += 1;
      group.covered ||= !!isCovered.get(p.id);
      groups.set(key, group);
    }
  }
  return [...groups.values()]
    .filter((g) => !g.covered)
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'uk'))
    .map((g) => g.name);
}
