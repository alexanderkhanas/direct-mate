import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate, ValidationError } from 'class-validator';
import { CatalogImportDto } from './catalog-import.dto';

/**
 * DTO-level validation tests for the catalog-import endpoint.
 *
 * These tests run class-validator directly against the DTO — no Nest
 * test module, no DB. They cover the four cases the controller relies
 * on for 400 rejection: invalid gender, salePrice > price, too many
 * categories, missing tenantId.
 */

const VALID_PRODUCT = {
  externalProductId: 'tor-100',
  title: 'Bottega Veneta Sandal',
  variants: [
    {
      externalVariantId: 'tor-100-37',
      sku: '729742VBSF0-37',
      size: '37',
      color: 'Чорний',
      price: 1064.44,
      currency: 'UAH',
      inventoryQty: 1,
    },
  ],
};

// Valid v4 UUIDs (the all-zero "nil" UUID isn't accepted by IsUUID()).
const TENANT_UUID = '11111111-1111-4111-8111-111111111111';
const CONNECTION_UUID = '22222222-2222-4222-8222-222222222222';

function buildPayload(overrides: Partial<CatalogImportDto> = {}): unknown {
  return {
    tenantId: TENANT_UUID,
    connectionId: CONNECTION_UUID,
    products: [VALID_PRODUCT],
    ...overrides,
  };
}

async function validateDto(payload: unknown): Promise<ValidationError[]> {
  const dto = plainToInstance(CatalogImportDto, payload);
  return validate(dto, { whitelist: true, forbidNonWhitelisted: false });
}

/**
 * Walk validation errors recursively (class-validator nests them under
 * `children` for ValidateNested fields) and collect every constraint
 * key. Lets tests assert "some constraint mentions X" without coupling
 * to the exact path the failure surfaced at.
 */
function collectConstraints(errors: ValidationError[]): string[] {
  const out: string[] = [];
  const walk = (errs: ValidationError[]) => {
    for (const e of errs) {
      if (e.constraints) out.push(...Object.values(e.constraints));
      if (e.children?.length) walk(e.children);
    }
  };
  walk(errors);
  return out;
}

describe('CatalogImportDto', () => {
  describe('happy path', () => {
    it('accepts a minimal valid payload', async () => {
      const errors = await validateDto(buildPayload());
      expect(errors).toEqual([]);
    });

    it('accepts the full Torgsoft-style payload', async () => {
      const payload = buildPayload({
        products: [
          {
            ...VALID_PRODUCT,
            description: 'Italian leather',
            categories: ['Взуття', 'Сандалі'],
            brand: 'Bottega Veneta',
            material: 'Leather',
            gender: 'female',
            season: 'summer',
            modelName: 'Stretch Strap Sandal',
            image: 'https://cdn.directmate.app/luxespace/images/178.jpg',
            status: 'active',
            variants: [
              {
                ...VALID_PRODUCT.variants[0],
                barcode: '2907010005972',
                salePrice: 532.22,
              },
            ],
          },
        ] as never,
      });
      const errors = await validateDto(payload);
      expect(errors).toEqual([]);
    });

    it('accepts product with 0 variants', async () => {
      // Edge case from spec: parent product persists even when no variants.
      const errors = await validateDto(
        buildPayload({
          products: [{ ...VALID_PRODUCT, variants: [] }] as never,
        }),
      );
      expect(errors).toEqual([]);
    });

    it('accepts gender = null', async () => {
      const errors = await validateDto(
        buildPayload({
          products: [{ ...VALID_PRODUCT, gender: null }] as never,
        }),
      );
      expect(errors).toEqual([]);
    });
  });

  describe('400 — validation failures', () => {
    it('rejects invalid gender value', async () => {
      const errors = await validateDto(
        buildPayload({
          products: [{ ...VALID_PRODUCT, gender: 'man' }] as never,
        }),
      );
      const messages = collectConstraints(errors);
      expect(messages.some((m) => m.includes('gender'))).toBe(true);
    });

    it('rejects salePrice greater than price', async () => {
      const errors = await validateDto(
        buildPayload({
          products: [
            {
              ...VALID_PRODUCT,
              variants: [
                { ...VALID_PRODUCT.variants[0], price: 100, salePrice: 150 },
              ],
            },
          ] as never,
        }),
      );
      const messages = collectConstraints(errors);
      expect(messages.some((m) => m.includes('salePrice'))).toBe(true);
    });

    it('rejects negative salePrice', async () => {
      const errors = await validateDto(
        buildPayload({
          products: [
            {
              ...VALID_PRODUCT,
              variants: [
                { ...VALID_PRODUCT.variants[0], price: 100, salePrice: -1 },
              ],
            },
          ] as never,
        }),
      );
      const messages = collectConstraints(errors);
      expect(messages.some((m) => m.includes('salePrice'))).toBe(true);
    });

    it('rejects more than 10 categories', async () => {
      const tooMany = Array.from({ length: 11 }, (_, i) => `Cat-${i}`);
      const errors = await validateDto(
        buildPayload({
          products: [{ ...VALID_PRODUCT, categories: tooMany }] as never,
        }),
      );
      const messages = collectConstraints(errors);
      expect(messages.some((m) => m.toLowerCase().includes('categories'))).toBe(true);
    });

    it('rejects category name longer than 100 chars', async () => {
      const errors = await validateDto(
        buildPayload({
          products: [
            { ...VALID_PRODUCT, categories: ['x'.repeat(101)] },
          ] as never,
        }),
      );
      const messages = collectConstraints(errors);
      expect(messages.some((m) => m.toLowerCase().includes('100'))).toBe(true);
    });

    it('rejects missing tenantId', async () => {
      const payload = buildPayload();
      delete (payload as Record<string, unknown>).tenantId;
      const errors = await validateDto(payload);
      // Find the tenantId-level error specifically.
      expect(errors.some((e) => e.property === 'tenantId')).toBe(true);
    });

    it('rejects non-UUID connectionId', async () => {
      const errors = await validateDto(buildPayload({ connectionId: 'not-a-uuid' }));
      expect(errors.some((e) => e.property === 'connectionId')).toBe(true);
    });

    it('rejects more than 10000 products', async () => {
      const many = Array.from({ length: 10001 }, (_, i) => ({
        ...VALID_PRODUCT,
        externalProductId: `tor-${i}`,
      }));
      const errors = await validateDto(buildPayload({ products: many as never }));
      const messages = collectConstraints(errors);
      expect(messages.some((m) => m.includes('10000'))).toBe(true);
    });
  });
});
