import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { DataSource, Repository } from 'typeorm';
import { AppModule } from '../../src/app.module';
import { CatalogService, ImportProductInput } from '../../src/modules/catalog/catalog.service';
import { Product } from '../../src/modules/catalog/entities/product.entity';
import { ProductVariant } from '../../src/modules/catalog/entities/product-variant.entity';
import { Category } from '../../src/modules/catalog/entities/category.entity';
import { Tenant } from '../../src/modules/tenants/entities/tenant.entity';
import { ProductStatus } from '@direct-mate/shared';

/**
 * Service-level integration tests for catalog import.
 *
 * Requires a running Postgres at $DATABASE_URL with all migrations
 * applied. Tests create an isolated tenant per suite and clean up
 * after themselves; the global product / variant / category tables
 * are not wiped, so this can run alongside other data without
 * side-effects.
 *
 * Run: `npm run test:e2e -- --testPathPatterns=catalog`
 */

const FRESH = (n: string) => `${n}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

describe('CatalogService.importCatalog (integration)', () => {
  let dataSource: DataSource;
  let catalogService: CatalogService;
  let productRepo: Repository<Product>;
  let variantRepo: Repository<ProductVariant>;
  let categoryRepo: Repository<Category>;
  let tenantRepo: Repository<Tenant>;
  let tenantId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app = moduleRef.createNestApplication();
    await app.init();

    dataSource = app.get(DataSource);
    catalogService = app.get(CatalogService);
    productRepo = dataSource.getRepository(Product);
    variantRepo = dataSource.getRepository(ProductVariant);
    categoryRepo = dataSource.getRepository(Category);
    tenantRepo = dataSource.getRepository(Tenant);

    // Spin up an isolated tenant for this suite.
    const tenant = await tenantRepo.save(
      tenantRepo.create({
        slug: FRESH('cat-import'),
        name: 'Catalog Import Test',
      } as Partial<Tenant>),
    );
    tenantId = tenant.id;
  });

  afterAll(async () => {
    if (tenantId) {
      // Cascade FKs handle the rest (products → variants, junction, media,
      // categories → junction). Tenants table itself owns the deletes.
      await tenantRepo.delete(tenantId);
    }
    await dataSource.destroy();
  });

  function makeProduct(overrides: Partial<ImportProductInput> = {}): ImportProductInput {
    return {
      externalProductId: FRESH('p'),
      title: 'Test Product',
      categories: ['Взуття'],
      brand: 'TestBrand',
      gender: 'female',
      season: 'summer',
      material: 'Cotton',
      modelName: 'TestModel',
      image: 'https://cdn.test/img.jpg',
      status: 'active',
      variants: [
        {
          externalVariantId: FRESH('v'),
          sku: 'sku-1',
          size: 'M',
          color: 'Чорний',
          price: 100,
          currency: 'UAH',
          inventoryQty: 5,
        },
      ],
      ...overrides,
    };
  }

  it('inserts 100 products with varied data', async () => {
    const products: ImportProductInput[] = Array.from({ length: 100 }, (_, i) => ({
      ...makeProduct(),
      externalProductId: `bulk-${i}`,
      title: `Bulk Product ${i}`,
      categories: i % 2 === 0 ? ['Взуття'] : ['Одяг', 'Жіноче'],
      gender: i % 3 === 0 ? 'female' : i % 3 === 1 ? 'male' : null,
      variants: [
        {
          externalVariantId: `bulk-${i}-v1`,
          sku: `sku-${i}-1`,
          size: 'M',
          color: 'Black',
          price: 100 + i,
          currency: 'UAH',
          inventoryQty: i,
        },
        {
          externalVariantId: `bulk-${i}-v2`,
          sku: `sku-${i}-2`,
          size: 'L',
          color: 'White',
          price: 100 + i,
          salePrice: 90 + i,
          currency: 'UAH',
          inventoryQty: i + 1,
        },
      ],
    }));

    const r = await catalogService.importCatalog(tenantId, products);
    expect(r.productsCreated).toBe(100);
    expect(r.productsUpdated).toBe(0);
    expect(r.variantsCreated).toBe(200);
    expect(r.errors).toEqual([]);

    const persistedCount = await productRepo.count({
      where: { tenantId, status: ProductStatus.Active },
    });
    expect(persistedCount).toBeGreaterThanOrEqual(100);

    // cleanup
    await productRepo.delete({ tenantId });
  });

  it('is idempotent — same payload twice produces no further writes', async () => {
    const products = [makeProduct()];

    const r1 = await catalogService.importCatalog(tenantId, products);
    expect(r1.productsCreated).toBe(1);

    const r2 = await catalogService.importCatalog(tenantId, products);
    expect(r2.productsCreated).toBe(0);
    expect(r2.productsUpdated).toBe(0);
    expect(r2.variantsCreated).toBe(0);
    expect(r2.variantsUpdated).toBe(0);

    await productRepo.delete({ tenantId });
  });

  it('only updates rows that actually changed', async () => {
    const p1 = makeProduct();
    const p2 = makeProduct();
    await catalogService.importCatalog(tenantId, [p1, p2]);

    // Modify p1's title only. p2 unchanged.
    const modified = [{ ...p1, title: 'Renamed Title' }, p2];
    const r = await catalogService.importCatalog(tenantId, modified);

    expect(r.productsCreated).toBe(0);
    expect(r.productsUpdated).toBe(1); // only p1
    expect(r.variantsUpdated).toBe(0); // variants untouched

    const updated = await productRepo.findOneOrFail({
      where: { tenantId, externalProductId: p1.externalProductId },
    });
    expect(updated.title).toBe('Renamed Title');

    await productRepo.delete({ tenantId });
  });

  it('archives products no longer present in payload (no hard delete)', async () => {
    const p1 = makeProduct();
    const p2 = makeProduct();
    await catalogService.importCatalog(tenantId, [p1, p2]);

    // Re-sync with only p1.
    const r = await catalogService.importCatalog(tenantId, [p1]);
    expect(r.productsArchived).toBe(1);

    const archived = await productRepo.findOneOrFail({
      where: { tenantId, externalProductId: p2.externalProductId },
    });
    expect(archived.status).toBe(ProductStatus.Archived);
    // Row still exists — no hard delete.
    expect(archived.id).toBeDefined();

    await productRepo.delete({ tenantId });
  });

  it('deduplicates categories case-insensitively', async () => {
    const p1 = makeProduct({ categories: ['Верхній одяг'] });
    const p2 = makeProduct({ categories: ['верхній одяг'] }); // different casing

    const r = await catalogService.importCatalog(tenantId, [p1, p2]);
    expect(r.categoriesCreated).toBe(1);

    const cats = await categoryRepo.find({ where: { tenantId } });
    expect(cats).toHaveLength(1);

    await productRepo.delete({ tenantId });
    await categoryRepo.delete({ tenantId });
  });

  it('accepts a product with 0 variants and persists the parent', async () => {
    const p = makeProduct({ variants: [] });
    const r = await catalogService.importCatalog(tenantId, [p]);

    expect(r.productsCreated).toBe(1);
    expect(r.variantsCreated).toBe(0);

    const persisted = await productRepo.findOneOrFail({
      where: { tenantId, externalProductId: p.externalProductId },
    });
    expect(persisted.title).toBe(p.title);

    const variants = await variantRepo.find({ where: { productId: persisted.id } });
    expect(variants).toHaveLength(0);

    await productRepo.delete({ tenantId });
  });

  it('persists all extended Torgsoft fields', async () => {
    const p = makeProduct({
      material: 'Wool',
      gender: 'male',
      season: 'winter',
      modelName: 'Polo Ralph Lauren Sweater',
      categories: ['Верхній одяг', 'Світшоти'],
      variants: [
        {
          externalVariantId: FRESH('v'),
          sku: 'sweater-l',
          size: 'L',
          color: 'Чорний',
          barcode: '2907010009499',
          price: 11270,
          salePrice: 7889,
          currency: 'UAH',
          inventoryQty: 5,
        },
      ],
    });

    await catalogService.importCatalog(tenantId, [p]);

    const persisted = await productRepo.findOneOrFail({
      where: { tenantId, externalProductId: p.externalProductId },
      relations: ['variants', 'categories'],
    });

    expect(persisted.material).toBe('Wool');
    expect(persisted.gender).toBe('male');
    expect(persisted.season).toBe('winter');
    expect(persisted.modelName).toBe('Polo Ralph Lauren Sweater');
    // first category denormalized into legacy column
    expect(persisted.category).toBe('Верхній одяг');
    expect(persisted.categories.map((c) => c.name).sort()).toEqual([
      'Верхній одяг',
      'Світшоти',
    ]);

    const v = persisted.variants[0];
    expect(v.barcode).toBe('2907010009499');
    expect(Number(v.salePrice)).toBe(7889);

    await productRepo.delete({ tenantId });
    await categoryRepo.delete({ tenantId });
  });
});
