import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AvailabilityService } from '../../availability/availability.service';

/**
 * How `search_products` finds candidates. The tool only ever sees ranked
 * product ids, so semantic search (embeddings, then pgvector) can replace this
 * later without changing what the model sees. Every search's result count
 * lands in the turn trace, which is how a misses report will decide when that
 * switch is worth it.
 */
export interface CatalogSearch {
  /**
   * Every match, best first, and how many there are. The caller decides how
   * many to show; `total` lets the model know the list goes on.
   */
  search(tenantId: string, query: { text: string; category?: string }): Promise<CatalogSearchResult>;

  /** Products with this SKU or article (product, model or variant code), read off a post or typed by the customer. */
  findBySku(tenantId: string, sku: string): Promise<string[]>;
}

export interface CatalogSearchResult {
  ids: string[];
  total: number;
}

export const CATALOG_SEARCH = Symbol('CATALOG_SEARCH');

/** Most matches a search returns; the tool shows fewer. */
const MAX_RANKED = 40;
const TTL_MS = 5 * 60 * 1000;

// Words that say nothing about the product.
const STOP_WORDS = new Set([
  'а', 'і', 'й', 'та', 'в', 'у', 'на', 'з', 'із', 'зі', 'до', 'для', 'по', 'про', 'є', 'чи', 'що', 'як',
  'хочу', 'шукаю', 'треба', 'потрібна', 'потрібен', 'потрібно', 'мені', 'покажіть', 'покажи', 'маєте',
  'щось', 'якийсь', 'якась', 'якісь', 'будь', 'ласка',
]);

// Customers describe a material with an adjective; titles name it with a noun
// («лляна сорочка» / «Сорочка льон»). Keyed by stem.
const MATERIAL_STEMS: Record<string, string> = {
  ллян: 'льон',
  бавовнян: 'бавовн',
  шкірян: 'шкір',
  вовнян: 'вовн',
  замшев: 'замш',
  джинсов: 'джинс',
  шовков: 'шовк',
};

const ENDINGS = [
  'ами', 'ями', 'ого', 'ому', 'ими', 'ий', 'ій', 'ої', 'ою', 'ею', 'ах', 'ях', 'ам', 'ям', 'ів', 'ей',
  'ом', 'ем', 'им', 'их', 'а', 'я', 'у', 'ю', 'і', 'и', 'е', 'о', 'ь',
];

/** A crude Ukrainian stem: strip one common ending, keep at least 3 letters. */
export function stem(word: string): string {
  const w = word.toLowerCase().replace(/['’ʼ]/g, '');
  if (w.length > 4) {
    for (const ending of ENDINGS) {
      if (w.endsWith(ending) && w.length - ending.length >= 3) {
        const s = w.slice(0, -ending.length);
        return MATERIAL_STEMS[s] ?? s;
      }
    }
  }
  return MATERIAL_STEMS[w] ?? w;
}

export function queryStems(text: string): string[] {
  const words: string[] = text.toLowerCase().match(/[\p{L}\d'’ʼ]+/gu) ?? [];
  return [...new Set(words.filter((w) => w.length > 1 && !STOP_WORDS.has(w)).map(stem))];
}

interface SearchRow {
  id: string;
  title: string;
  category: string | null;
  search_keywords: string | null;
}

interface SkuRow {
  id: string;
  sku: string | null;
  model_name: string | null;
  variant_skus: string[] | null;
}

/**
 * Ranks the whole catalog in memory — a store has 20 to 300 products, and the
 * keyword search behind the old engine returned 5 by sync time, not relevance,
 * so the product the customer meant was often missing and the agent reported
 * it out of stock. Title matches weigh most; among equal scores the shorter
 * title wins, so «Сорочка льон» ranks above «Сорочка льон морська хвиля».
 * Falls back to the keyword search (which also reads descriptions) when
 * nothing ranks.
 */
@Injectable()
export class RankedCatalogSearch implements CatalogSearch {
  private readonly cache = new Map<string, { rows: SearchRow[]; expiresAt: number }>();
  private readonly skuCache = new Map<string, { rows: SkuRow[]; expiresAt: number }>();

  constructor(
    private readonly dataSource: DataSource,
    private readonly availability: AvailabilityService,
  ) {}

  async search(tenantId: string, query: { text: string; category?: string }): Promise<CatalogSearchResult> {
    const ranked = rankProducts(await this.rows(tenantId), query.text, query.category);
    if (ranked.length > 0) return { ids: ranked.slice(0, MAX_RANKED), total: ranked.length };

    const fallback = await this.availability.checkAll(tenantId, { query: query.text, category: query.category });
    return { ids: fallback.map((r) => r.product.id), total: fallback.length };
  }

  async findBySku(tenantId: string, sku: string): Promise<string[]> {
    return matchSku(await this.skuRows(tenantId), sku);
  }

  private async skuRows(tenantId: string): Promise<SkuRow[]> {
    const cached = this.skuCache.get(tenantId);
    if (cached && cached.expiresAt > Date.now()) return cached.rows;
    const rows: SkuRow[] = await this.dataSource.query(
      `SELECT p.id, p.sku, p.model_name, array_remove(array_agg(v.sku), NULL) AS variant_skus
         FROM products p
         LEFT JOIN product_variants v ON v.product_id = p.id AND v.active = true
        WHERE p.tenant_id = $1 AND p.status = 'active'
        GROUP BY p.id`,
      [tenantId],
    );
    this.skuCache.set(tenantId, { rows, expiresAt: Date.now() + TTL_MS });
    return rows;
  }

  private async rows(tenantId: string): Promise<SearchRow[]> {
    const cached = this.cache.get(tenantId);
    if (cached && cached.expiresAt > Date.now()) return cached.rows;
    const rows: SearchRow[] = await this.dataSource.query(
      `SELECT id, title, category, search_keywords FROM products
        WHERE tenant_id = $1 AND status = 'active'`,
      [tenantId],
    );
    this.cache.set(tenantId, { rows, expiresAt: Date.now() + TTL_MS });
    return rows;
  }
}

export function rankProducts(rows: SearchRow[], text: string, category?: string): string[] {
  const stems = queryStems(text);
  const wanted = category?.trim().toLowerCase();
  const inCategory = wanted ? rows.filter((r) => r.category?.toLowerCase() === wanted) : rows;
  const pool = inCategory.length > 0 ? inCategory : rows;
  if (stems.length === 0) {
    return wanted && inCategory.length > 0 ? pool.sort((a, b) => a.title.length - b.title.length).map((r) => r.id) : [];
  }

  return pool
    .map((r) => {
      const title = r.title.toLowerCase();
      const cat = r.category?.toLowerCase() ?? '';
      const keywords = r.search_keywords?.toLowerCase() ?? '';
      let score = 0;
      for (const s of stems) {
        if (title.includes(s)) score += 3;
        else if (cat.includes(s)) score += 2;
        else if (keywords.includes(s)) score += 1;
      }
      return { id: r.id, score, length: r.title.length };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || a.length - b.length)
    .map((r) => r.id);
}

/** What separates the parts of a code: «LV-2933», «AB.12/RED». */
const SKU_SEPARATORS = /[\s\-‐‑–—_/.]+/gu;

/** A code as written on a post or by a customer: «Арт. LV-2933», «sku: lv 2933», «LV.2933» → «lv2933». */
export function normalizeSku(code: string): string {
  return code
    .trim()
    .replace(/^(?:sku|арт(?:икул)?|art(?:icle)?|код|code)(?:[.:#№]|\s)+/iu, '')
    .replace(/^[#№]\s*/u, '')
    .replace(SKU_SEPARATORS, '')
    .toLowerCase();
}

/**
 * Products whose SKU or model code is this one, ignoring case and separators
 * (spaces, dashes, dots, slashes). When none is, a variant SKU that starts with it at a separator:
 * stores often code a variant as article-colour-size («ADID-002-BILY-M»), and
 * a post shows the article («ADID-002»). At least two segments, so a brand
 * prefix («ADID») doesn't list the whole brand.
 */
export function matchSku(rows: SkuRow[], code: string): string[] {
  const wanted = normalizeSku(code);
  if (wanted.length < 2) return [];
  const exact = rows.filter((r) =>
    [r.sku, r.model_name, ...(r.variant_skus ?? [])].some((c) => c && normalizeSku(c) === wanted),
  );
  if (exact.length > 0) return exact.map((r) => r.id);
  if (wanted.length < 3) return [];
  return rows
    .filter((r) =>
      (r.variant_skus ?? []).some((c) => {
        const segments = c.toLowerCase().split(SKU_SEPARATORS).filter(Boolean);
        for (let k = 2; k < segments.length; k++) if (segments.slice(0, k).join('') === wanted) return true;
        return false;
      }),
    )
    .map((r) => r.id);
}
