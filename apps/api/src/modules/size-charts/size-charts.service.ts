import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { DataSource, Repository } from 'typeorm';
import * as fs from 'fs/promises';
import * as path from 'path';
import { SizeChart } from './size-chart.entity';
import { lowerTrim, lowerTrimArray } from './normalize';

interface CreateSizeChartDto {
  name: string;
  imagePath: string;
  categories?: string[];
  brands?: string[];
  isDefault?: boolean;
}

interface UpdateSizeChartDto {
  name?: string;
  imagePath?: string;
  categories?: string[];
  brands?: string[];
  isDefault?: boolean;
}

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

  async create(tenantId: string, dto: CreateSizeChartDto): Promise<SizeChart> {
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

  async update(
    tenantId: string,
    id: string,
    dto: UpdateSizeChartDto,
  ): Promise<SizeChart> {
    const existing = await this.repo.findOne({ where: { id, tenantId } });
    if (!existing) throw new NotFoundException('Size chart not found');

    return this.dataSource.transaction(async (manager) => {
      if (dto.isDefault === true && !existing.isDefault) {
        await manager
          .getRepository(SizeChart)
          .update({ tenantId, isDefault: true }, { isDefault: false });
      }
      if (dto.name !== undefined) existing.name = dto.name.trim();
      if (dto.imagePath !== undefined) existing.imagePath = dto.imagePath;
      if (dto.brands !== undefined) existing.brands = lowerTrimArray(dto.brands);
      if (dto.categories !== undefined)
        existing.categories = lowerTrimArray(dto.categories);
      if (dto.isDefault !== undefined) existing.isDefault = !!dto.isDefault;
      return manager.getRepository(SizeChart).save(existing);
    });
  }

  async delete(tenantId: string, id: string): Promise<void> {
    const existing = await this.repo.findOne({ where: { id, tenantId } });
    if (!existing) throw new NotFoundException('Size chart not found');
    await this.repo.delete({ id, tenantId });
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
   * Look up a product's brand/category in the catalog. Used by the reply
   * engine to derive chart-resolution context without pulling ProductRepository
   * into the reply engine.
   */
  async getBrandAndCategoryForProduct(
    tenantId: string,
    productId: string,
  ): Promise<{ brand: string | null; category: string | null }> {
    const rows: Array<{ brand: string | null; category: string | null }> =
      await this.dataSource.query(
        `SELECT brand, category FROM products WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
        [productId, tenantId],
      );
    return rows[0] ?? { brand: null, category: null };
  }

  /**
   * Distinct brand values across a tenant's active products. Used by the
   * admin UI to suggest brands when tagging a chart.
   */
  async listTenantBrands(tenantId: string): Promise<string[]> {
    const rows: Array<{ brand: string | null }> = await this.dataSource.query(
      `SELECT DISTINCT brand FROM products
       WHERE tenant_id = $1 AND brand IS NOT NULL AND brand <> ''
       ORDER BY brand`,
      [tenantId],
    );
    return rows.map((r) => r.brand).filter((b): b is string => !!b);
  }

  async listTenantCategories(tenantId: string): Promise<string[]> {
    const rows: Array<{ category: string | null }> = await this.dataSource.query(
      `SELECT DISTINCT category FROM products
       WHERE tenant_id = $1 AND category IS NOT NULL AND category <> ''
       ORDER BY category`,
      [tenantId],
    );
    return rows.map((r) => r.category).filter((c): c is string => !!c);
  }

  /**
   * Strict tie-break resolver. Returns the single best matching chart, or null.
   *  1. brand + category exact match
   *  2. brand match only
   *  3. category match only
   *  4. tenant's default chart
   *  5. null
   */
  async resolveForContext(
    tenantId: string,
    ctx: { brand?: string | null; category?: string | null },
  ): Promise<SizeChart | null> {
    const brand = ctx.brand ? lowerTrim(ctx.brand) : null;
    const category = ctx.category ? lowerTrim(ctx.category) : null;

    if (brand && category) {
      const exact = await this.repo
        .createQueryBuilder('sc')
        .where('sc.tenant_id = :tenantId', { tenantId })
        .andWhere(':brand = ANY(sc.brands)', { brand })
        .andWhere(':category = ANY(sc.categories)', { category })
        .orderBy('sc.created_at', 'DESC')
        .limit(1)
        .getOne();
      if (exact) return exact;
    }

    if (brand) {
      const byBrand = await this.repo
        .createQueryBuilder('sc')
        .where('sc.tenant_id = :tenantId', { tenantId })
        .andWhere(':brand = ANY(sc.brands)', { brand })
        .orderBy('sc.created_at', 'DESC')
        .limit(1)
        .getOne();
      if (byBrand) return byBrand;
    }

    if (category) {
      const byCategory = await this.repo
        .createQueryBuilder('sc')
        .where('sc.tenant_id = :tenantId', { tenantId })
        .andWhere(':category = ANY(sc.categories)', { category })
        .orderBy('sc.created_at', 'DESC')
        .limit(1)
        .getOne();
      if (byCategory) return byCategory;
    }

    const defaultChart = await this.repo.findOne({
      where: { tenantId, isDefault: true },
    });
    if (defaultChart) return defaultChart;

    return null;
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
}
