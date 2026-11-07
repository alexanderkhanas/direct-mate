import { XMLParser } from 'fast-xml-parser';
import type { ImportProductInput } from '../../catalog/catalog.service';
import {
  colorFromTitle,
  groupTitle,
  mergeImages,
  parsePrice,
  plainText,
  sizeFromTitle,
  WarningLog,
  type ParsedFeed,
} from '../feed-normalize';

type Node = Record<string, unknown>;

const COLOR_PARAM = /^(колір|цвет|color|колір товару|основний колір)$/i;
const SIZE_PARAM = /^(розмір|размер|size|розмір виробника|размер производителя)$/i;

/**
 * YML (Yandex Market Language), the export Prom, Rozetka and Horoshop give
 * stores. Each `<offer>` is one variant; offers sharing `group_id` are one
 * product. Colour and size come from `<param>`; Rozetka's `name_ua` /
 * `description_ua` are preferred to the Russian fields when present.
 */
export function parseYml(xml: string, warnings = new WarningLog()): Omit<ParsedFeed, 'format'> {
  const doc = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@',
    parseTagValue: false,
    parseAttributeValue: false,
    trimValues: true,
    htmlEntities: true,
    isArray: (name) => ['offer', 'category', 'picture', 'param', 'currency'].includes(name),
  }).parse(xml) as Node;

  const shop = ((doc.yml_catalog as Node | undefined)?.shop as Node | undefined) ?? (doc.shop as Node | undefined);
  if (!shop) throw new Error('Not a YML feed: no <yml_catalog><shop>');
  const categoryNames = categoryMap(shop);
  const offers: Node[] = ((shop.offers as Node | undefined)?.offer as Node[] | undefined) ?? [];

  const groups = new Map<string, Array<{ offer: Node; id: string }>>();
  const seen = new Set<string>();
  for (const offer of offers) {
    const id = attr(offer, 'id');
    const title = name(offer);
    if (!id || !title || !parsePrice(text(offer.price))) {
      warnings.add('skipped_no_price', title ?? id ?? undefined);
      continue;
    }
    if (seen.has(id)) {
      warnings.add('duplicate_ids', id);
      continue;
    }
    seen.add(id);
    let groupId = attr(offer, 'group_id') ?? attr(offer, 'groupId');
    if (!groupId) {
      // A product with one size/colour is fine on its own; only report real guesses.
      groupId = `title:${groupTitle([title]).toLowerCase()}`;
    }
    if (!groups.has(groupId)) groups.set(groupId, []);
    groups.get(groupId)!.push({ offer, id });
  }
  for (const [groupId, members] of groups) {
    if (groupId.startsWith('title:') && members.length > 1) warnings.add('no_group_id', name(members[0].offer)!, members.length);
  }

  const products: ImportProductInput[] = [];
  for (const [groupId, members] of groups) {
    const first = members[0].offer;
    const titles = members.map((m) => name(m.offer)!);
    const images: Array<{ url: string; color: string | null }> = [];
    const variants: ImportProductInput['variants'] = members.map(({ offer, id }) => {
      const title = name(offer)!;
      const current = parsePrice(text(offer.price))!;
      const old = parsePrice(text(offer.oldprice));
      const onSale = old !== null && old.amount > current.amount;
      const color = param(offer, COLOR_PARAM) ?? (members.length > 1 ? colorFromTitle(title) : null);
      const size = param(offer, SIZE_PARAM) ?? (members.length > 1 ? sizeFromTitle(title) : null);
      for (const url of list(offer.picture)) images.push({ url, color });
      return {
        externalVariantId: id,
        sku: text(offer.vendorCode) ?? text(offer.article) ?? id,
        barcode: text(offer.barcode),
        size,
        color,
        price: onSale ? old!.amount : current.amount,
        salePrice: onSale ? current.amount : null,
        currency: text(offer.currencyId) ?? current.currency ?? 'UAH',
        inventoryQty: stock(offer),
      };
    });
    const category = categoryNames.get(text(first.categoryId) ?? '');
    products.push({
      externalProductId: groupId.startsWith('title:') ? members[0].id : groupId,
      title: groupTitle(titles),
      description: plainText(text(first.description_ua) ?? text(first.description)),
      categories: category ? [category] : [],
      brand: text(first.vendor),
      images: mergeImages(images),
      variants,
      metadata: { url: text(first.url) },
    });
  }
  return { products, warnings: warnings.list(), itemCount: offers.length };
}

function categoryMap(shop: Node): Map<string, string> {
  const map = new Map<string, string>();
  const categories = ((shop.categories as Node | undefined)?.category as unknown[] | undefined) ?? [];
  for (const c of categories) {
    const id = typeof c === 'object' && c ? attr(c as Node, 'id') : null;
    const label = text(c);
    if (id && label) map.set(id, label);
  }
  return map;
}

function name(offer: Node): string | null {
  return text(offer.name_ua) ?? text(offer.name) ?? [text(offer.typePrefix), text(offer.vendor), text(offer.model)].filter(Boolean).join(' ') ?? null;
}

function param(offer: Node, pattern: RegExp): string | null {
  for (const p of (offer.param as unknown[] | undefined) ?? []) {
    if (typeof p === 'object' && p && pattern.test(attr(p as Node, 'name') ?? '')) return text(p);
  }
  return null;
}

/** `quantity_in_stock` (Prom) or `stock_quantity` (Rozetka) when given; else `available` as 1/0. */
function stock(offer: Node): number {
  for (const key of ['quantity_in_stock', 'stock_quantity', 'quantity']) {
    const n = Number(text(offer[key]));
    if (text(offer[key]) !== null && Number.isFinite(n)) return Math.max(0, Math.floor(n));
  }
  const available = attr(offer, 'available');
  return available === null || available === 'true' ? 1 : 0;
}

function attr(node: Node, key: string): string | null {
  const v = node[`@${key}`];
  return v === undefined || v === null || String(v).trim() === '' ? null : String(v).trim();
}

function text(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return text(value[0]);
  if (typeof value === 'object') return text((value as Node)['#text']);
  const s = String(value).trim();
  return s || null;
}

function list(value: unknown): string[] {
  if (value === null || value === undefined) return [];
  return (Array.isArray(value) ? value : [value]).map(text).filter((s): s is string => !!s);
}
