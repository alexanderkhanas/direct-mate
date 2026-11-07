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

const GOOGLE_NS = 'http://base.google.com/ns/1.0';

type Node = Record<string, unknown>;

/**
 * Google Merchant Center product feed, RSS 2.0 or Atom
 * (https://support.google.com/merchants/answer/7052112). Each item is one
 * variant; items sharing `item_group_id` are one product. Feeds without group
 * ids are grouped by title with its colour and size removed.
 */
export function parseGoogleMerchant(xml: string, warnings = new WarningLog()): Omit<ParsedFeed, 'format'> {
  const doc = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@',
    parseTagValue: false,
    parseAttributeValue: false,
    trimValues: true,
    htmlEntities: true,
    isArray: (name) => ['item', 'entry', 'link'].includes(name) || /additional_image_link$|product_type$/.test(name),
  }).parse(xml) as Node;

  const root = (doc.rss as Node | undefined) ?? (doc.feed as Node | undefined);
  if (!root) throw new Error('Not a Google Merchant feed: no <rss> or <feed> root');
  const g = googlePrefix(root);
  const items: Node[] = ((root.channel as Node | undefined)?.item as Node[] | undefined) ?? (root.entry as Node[] | undefined) ?? [];

  const field = (item: Node, name: string): string | null => text(item[`${g}:${name}`]) ?? text(item[name]);
  const groups = new Map<string, Array<{ item: Node; id: string }>>();
  const seenIds = new Set<string>();
  for (const item of items) {
    const id = field(item, 'id');
    const title = field(item, 'title');
    if (!id || !title || !parsePrice(field(item, 'price'))) {
      warnings.add('skipped_no_price', title ?? id ?? undefined);
      continue;
    }
    if (seenIds.has(id)) {
      warnings.add('duplicate_ids', id);
      continue;
    }
    seenIds.add(id);
    const groupId = field(item, 'item_group_id') ?? `title:${groupTitle([title]).toLowerCase()}`;
    if (!groups.has(groupId)) groups.set(groupId, []);
    groups.get(groupId)!.push({ item, id });
  }
  // A single item without a group id is just a simple product; several grouped by title are a guess.
  for (const [groupId, members] of groups) {
    if (groupId.startsWith('title:') && members.length > 1) {
      warnings.add('no_group_id', field(members[0].item, 'title')!, members.length);
    }
  }

  const products: ImportProductInput[] = [];
  for (const [groupId, members] of groups) {
    const titles = members.map((m) => field(m.item, 'title')!);
    const first = members[0].item;
    const images: Array<{ url: string; color: string | null }> = [];
    const variants: ImportProductInput['variants'] = members.map(({ item, id }) => {
      const title = field(item, 'title')!;
      const price = parsePrice(field(item, 'price'))!;
      const sale = parsePrice(field(item, 'sale_price'));
      const color = field(item, 'color') ?? (members.length > 1 ? colorFromTitle(title) : null);
      const size = field(item, 'size') ?? (members.length > 1 ? sizeFromTitle(title) : null);
      for (const url of [field(item, 'image_link'), ...list(item[`${g}:additional_image_link`])]) {
        if (url) images.push({ url, color });
      }
      return {
        externalVariantId: id,
        sku: field(item, 'mpn') ?? id,
        barcode: field(item, 'gtin'),
        size,
        color,
        price: price.amount,
        salePrice: sale && sale.amount < price.amount ? sale.amount : null,
        currency: price.currency ?? 'UAH',
        inventoryQty: stock(field(item, 'quantity'), field(item, 'availability')),
      };
    });

    const productType = list(first[`${g}:product_type`])[0] ?? text(first.product_type);
    const path = productType?.split('>').map((s) => s.trim()).filter(Boolean) ?? [];
    products.push({
      externalProductId: groupId.startsWith('title:') ? members[0].id : groupId,
      title: groupTitle(titles),
      description: plainText(field(first, 'description')),
      categories: path.length > 0 ? [path[path.length - 1]] : [],
      brand: field(first, 'brand'),
      material: field(first, 'material'),
      gender: gender(field(first, 'gender'), field(first, 'age_group')),
      images: mergeImages(images),
      variants,
      metadata: { url: link(first, g), ...(path.length > 1 && { categoryPath: path.join(' > ') }) },
    });
  }
  return { products, warnings: warnings.list(), itemCount: items.length };
}

/** The prefix bound to Google's namespace (almost always `g`). */
function googlePrefix(root: Node): string {
  for (const [key, value] of Object.entries(root)) {
    if (key.startsWith('@xmlns:') && value === GOOGLE_NS) return key.slice('@xmlns:'.length);
  }
  return 'g';
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

/** RSS `<link>url</link>` or `<g:link>`, Atom `<link href="url"/>`. */
function link(item: Node, g: string): string | null {
  const own = text(item[`${g}:link`]);
  if (own) return own;
  const links = Array.isArray(item.link) ? item.link : item.link ? [item.link] : [];
  for (const l of links) {
    if (typeof l === 'string' && l.trim()) return l.trim();
    const href = (l as Node)?.['@href'];
    if (typeof href === 'string') return href;
    const inner = text(l);
    if (inner) return inner;
  }
  return null;
}

/** A count when the feed gives one; otherwise 1 for in stock, 0 for anything else. */
function stock(quantity: string | null, availability: string | null): number {
  const n = quantity !== null ? Number(quantity) : NaN;
  if (Number.isFinite(n)) return Math.max(0, Math.floor(n));
  return /^in[ _]stock$/i.test(availability ?? '') ? 1 : 0;
}

function gender(raw: string | null, ageGroup: string | null): ImportProductInput['gender'] {
  if (ageGroup && /kids|toddler|infant|newborn/i.test(ageGroup)) return 'kids';
  const g = raw?.toLowerCase();
  return g === 'male' || g === 'female' || g === 'unisex' ? g : null;
}
