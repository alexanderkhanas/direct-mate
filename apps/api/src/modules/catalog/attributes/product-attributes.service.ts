import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, EntityManager } from 'typeorm';
import { createOpenAI, type OpenAIProvider } from '@ai-sdk/openai';
import { generateText, Output } from 'ai';
import { z } from 'zod';
import { readFile } from 'fs/promises';
import { extname, join, resolve, sep } from 'path';
import {
  ATTRIBUTE_VALUES,
  AttributeKey,
  AttributesMeta,
  AttributeSource,
  ProductAttributes,
  applyManualPatch,
  attributesInputHash,
  mergeExtracted,
} from './product-attributes';

const DEFAULT_MODEL = 'gpt-6.1-terra';

// The SQL twin of `attributesInputHash`; the stale query and the extraction
// must agree on which photo is "main" (first by sort order, as in the catalog).
const MAIN_IMAGE = `(SELECT url FROM product_media m WHERE m.product_id = p.id
                      ORDER BY m.sort_order, m.created_at, m.id LIMIT 1)`;

const INSTRUCTIONS = `You describe how a clothing or footwear item looks, for an online shop's catalog. Judge from the photo first; use the title and description for what the photo can't show (fabric, a hidden collar). Describe the item the product is about, not the model's other clothes or the background.

- formality: how dressy the item is by its cut and fabric, not its colour.
  святкова: goes with a suit or to a wedding or formal event (dress shirts with a classic collar, blazers, suits, dress trousers, classic leather shoes).
  смарт-кежуал: neat but not formal (polos, button-down or casual shirts, chinos, fine knitwear, loafers, clean minimal sneakers).
  повсякденна: everyday (T-shirts, hoodies, sweatshirts, jeans, shorts, sportswear, graphic prints, oversized cuts, sneakers).
- pattern: the visible pattern.
- colour: the main colour in Ukrainian, masculine nominative, e.g. «білий», «темно-синій», «бежевий меланж».
- fabricLook: how the fabric surface looks.
- collar: the collar or neckline; null for items without one (trousers, shorts, shoes).
- fit: how the cut fits the body; null for shoes and accessories.

Use only the listed values. When the photo doesn't show something, use null rather than guessing.`;

const extractionSchema = z.object({
  formality: z.enum(ATTRIBUTE_VALUES.formality),
  pattern: z.enum(ATTRIBUTE_VALUES.pattern).nullable(),
  colour: z.string().nullable(),
  fabricLook: z.enum(ATTRIBUTE_VALUES.fabricLook).nullable(),
  collar: z.enum(ATTRIBUTE_VALUES.collar).nullable(),
  fit: z.enum(ATTRIBUTE_VALUES.fit).nullable(),
});

const MEDIA_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

interface ProductRow {
  id: string;
  tenant_id: string;
  title: string;
  category: string | null;
  description: string | null;
  attributes: ProductAttributes | null;
  attributes_meta: AttributesMeta | null;
  image_url: string | null;
}

export type ExtractionResult =
  | { ok: true; attributes: ProductAttributes; sources: Partial<Record<AttributeKey, AttributeSource>> }
  | { ok: false; error: string };

export interface AttributesView {
  attributes: ProductAttributes;
  sources: Partial<Record<AttributeKey, AttributeSource>>;
}

/**
 * Reads products' visual attributes from their main photo, and stores the
 * admin's edits. Extraction never overwrites an attribute an admin set unless
 * asked to ("read again from the photo").
 */
@Injectable()
export class ProductAttributesService {
  private readonly logger = new Logger(ProductAttributesService.name);
  private openai: OpenAIProvider | null = null;

  constructor(
    private readonly dataSource: DataSource,
    private readonly config: ConfigService,
  ) {}

  modelId(): string {
    return this.config.get<string>('attributes.model') ?? DEFAULT_MODEL;
  }

  /**
   * Products to read: never read, or read from a title, category, description
   * or main photo that has since changed. A failed product waits
   * `backoffMinutes` before it is tried again. `force` returns every active
   * product (the CLI's re-read).
   */
  async findStale(opts: { tenantId?: string; limit: number; backoffMinutes: number; force?: boolean }): Promise<string[]> {
    const rows: Array<{ id: string }> = await this.dataSource.query(
      `SELECT p.id FROM products p
        WHERE p.status = 'active'
          AND ($1::uuid IS NULL OR p.tenant_id = $1)
          AND ($2::boolean
               OR ((p.attributes_meta IS NULL
                    OR p.attributes_meta->>'inputHash' IS DISTINCT FROM
                       md5(concat_ws('|', p.title, p.category, p.description, ${MAIN_IMAGE})))
                   AND (p.attributes_meta->>'attemptedAt' IS NULL
                    OR (p.attributes_meta->>'attemptedAt')::timestamptz < now() - make_interval(mins => $3))))
        ORDER BY p.created_at, p.id
        LIMIT $4`,
      [opts.tenantId ?? null, !!opts.force, opts.backoffMinutes, opts.limit],
    );
    return rows.map((r) => r.id);
  }

  /** Read one product's attributes from its photo and store them. */
  async extract(
    productId: string,
    opts: { tenantId?: string; overwriteManual?: boolean; modelId?: string } = {},
  ): Promise<ExtractionResult> {
    const product = await this.load(this.dataSource.manager, productId, opts.tenantId);
    if (!product) return { ok: false, error: 'Product not found.' };
    const modelId = opts.modelId ?? this.modelId();
    const inputHash = attributesInputHash({
      title: product.title,
      category: product.category,
      description: product.description,
      imageUrl: product.image_url,
    });

    let extracted: z.infer<typeof extractionSchema>;
    try {
      extracted = await this.callModel(product, modelId);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Attribute extraction failed for product ${productId}: ${error}`);
      await this.dataSource.query(
        `UPDATE products SET attributes_meta = COALESCE(attributes_meta, '{}'::jsonb) || $2::jsonb WHERE id = $1`,
        [productId, JSON.stringify({ attemptedAt: new Date().toISOString(), error: error.slice(0, 500) })],
      );
      return { ok: false, error };
    }

    // Merge into the row as it is now: an admin edit made while the model was
    // thinking must survive.
    return this.dataSource.transaction(async (manager) => {
      const current = await this.load(manager, productId, opts.tenantId, true);
      if (!current) return { ok: false as const, error: 'Product not found.' };
      const { attributes, sources } = mergeExtracted(current.attributes ?? {}, current.attributes_meta, extracted, {
        overwriteManual: opts.overwriteManual,
      });
      const now = new Date().toISOString();
      const meta: AttributesMeta = { sources, inputHash, model: modelId, extractedAt: now, attemptedAt: now };
      await manager.query(`UPDATE products SET attributes = $2, attributes_meta = $3 WHERE id = $1`, [
        productId,
        JSON.stringify(attributes),
        JSON.stringify(meta),
      ]);
      return { ok: true as const, attributes, sources };
    });
  }

  /** Admin edits; null clears a value. Returns null when the product isn't this store's. */
  async setManual(
    tenantId: string,
    productId: string,
    patch: Partial<Record<AttributeKey, string | null>>,
  ): Promise<AttributesView | null> {
    return this.dataSource.transaction(async (manager) => {
      const current = await this.load(manager, productId, tenantId, true);
      if (!current) return null;
      const { attributes, meta } = applyManualPatch(current.attributes ?? {}, current.attributes_meta, patch);
      await manager.query(`UPDATE products SET attributes = $2, attributes_meta = $3 WHERE id = $1`, [
        productId,
        JSON.stringify(attributes),
        JSON.stringify(meta),
      ]);
      return { attributes, sources: meta.sources ?? {} };
    });
  }

  private async load(
    manager: EntityManager,
    productId: string,
    tenantId?: string,
    forUpdate = false,
  ): Promise<ProductRow | null> {
    const rows: ProductRow[] = await manager.query(
      `SELECT p.id, p.tenant_id, p.title, p.category, p.description, p.attributes, p.attributes_meta,
              ${MAIN_IMAGE} AS image_url
         FROM products p
        WHERE p.id = $1 AND ($2::uuid IS NULL OR p.tenant_id = $2)
        ${forUpdate ? 'FOR UPDATE OF p' : ''}`,
      [productId, tenantId ?? null],
    );
    return rows[0] ?? null;
  }

  private async callModel(product: ProductRow, modelId: string): Promise<z.infer<typeof extractionSchema>> {
    const openai = this.provider();
    if (!openai) throw new Error('OPENAI_API_KEY is not set');

    const text = [
      `Title: ${product.title}`,
      product.category && `Category: ${product.category}`,
      product.description && `Description: ${product.description.slice(0, 1500)}`,
      !product.image_url && 'There is no photo; judge from the text, and use null where it says nothing.',
    ]
      .filter(Boolean)
      .join('\n');
    const image = product.image_url ? await this.imagePart(product.image_url) : null;
    const effort = this.config.get<string>('attributes.reasoningEffort');

    const result = await generateText({
      model: openai(modelId),
      instructions: INSTRUCTIONS,
      output: Output.object({ schema: extractionSchema, name: 'product_attributes' }),
      messages: [{ role: 'user', content: [{ type: 'text', text }, ...(image ? [image] : [])] }],
      ...(effort && { providerOptions: { openai: { reasoningEffort: effort } } }),
      maxRetries: 2,
    });
    if (!result.output) throw new Error('The model returned no attributes');
    return result.output;
  }

  /**
   * Remote photos go to the model as URLs. Demo stores keep theirs under
   * `uploads/` (served by the API, not reachable by the model), so those are
   * read from disk.
   */
  private async imagePart(url: string): Promise<{ type: 'file'; data: URL | Uint8Array; mediaType: string } | null> {
    if (/^https?:\/\//i.test(url)) {
      const ext = extname(new URL(url).pathname).toLowerCase();
      return { type: 'file', data: new URL(url), mediaType: MEDIA_TYPES[ext] ?? 'image' };
    }
    if (!url.startsWith('/uploads/')) return null;
    const root = resolve(process.cwd(), 'uploads');
    const file = resolve(join(process.cwd(), url));
    if (!file.startsWith(root + sep)) return null;
    try {
      const bytes = await readFile(file);
      return { type: 'file', data: new Uint8Array(bytes), mediaType: MEDIA_TYPES[extname(file).toLowerCase()] ?? 'image/jpeg' };
    } catch {
      this.logger.warn(`Product photo ${url} is not on disk; reading attributes from text only`);
      return null;
    }
  }

  private provider(): OpenAIProvider | null {
    if (this.openai) return this.openai;
    const apiKey = this.config.get<string>('openai.apiKey');
    if (!apiKey) return null;
    this.openai = createOpenAI({ apiKey });
    return this.openai;
  }
}
