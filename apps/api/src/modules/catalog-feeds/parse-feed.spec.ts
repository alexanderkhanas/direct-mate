import { readFileSync } from 'fs';
import { join } from 'path';
import { parseFeed } from './parse-feed';
import { detectFormat, feedUrl } from './feed-fetcher';
import { parsePrice, plainText } from './feed-normalize';
import { parseCsv } from './parsers/sheet.parser';

const fixture = (name: string) => readFileSync(join(__dirname, '__fixtures__', name), 'utf8');
const NO_LIMIT = { maxProducts: null };

describe('parseFeed — Google Merchant', () => {
  const feed = parseFeed('gmc', fixture('gmc-rss.xml'), NO_LIMIT);
  const shirt = feed.products.find((p) => p.externalProductId === 'feed:1001')!;

  it('groups items by item_group_id into one product, named by what the titles share', () => {
    expect(feed.products.map((p) => p.externalProductId)).toEqual(['feed:1001', 'feed:2002']);
    expect(shirt.title).toBe('Сорочка льон');
    expect(shirt.variants.map((v) => [v.externalVariantId, v.color, v.size, v.inventoryQty])).toEqual([
      ['feed:1001-M', 'Білий', 'M', 1],
      ['feed:1001-L', 'Білий', 'L', 0],
      ['feed:1001-BLK-M', 'Чорний', 'M', 1],
    ]);
  });

  it('reads prices, sale prices, category path, description, images and the product link', () => {
    expect(shirt.variants[0]).toMatchObject({ price: 3300, salePrice: 2900, currency: 'UAH', barcode: '4820000000011' });
    expect(shirt.categories).toEqual(['Сорочки']);
    expect(shirt.description).toBe('Легка сорочка з льону для літа.');
    expect(shirt.gender).toBe('male');
    expect(shirt.metadata).toMatchObject({ url: 'https://altamen.example/p/sorochka-lon', categoryPath: 'Чоловікам > Одяг > Сорочки' });
    expect(shirt.images).toEqual([
      { url: 'https://cdn.example/lon-white-1.jpg', color: 'Білий', sortOrder: 0 },
      { url: 'https://cdn.example/lon-white-2.jpg', color: 'Білий', sortOrder: 1 },
      { url: 'https://cdn.example/lon-black.jpg', color: 'Чорний', sortOrder: 2 },
    ]);
    expect(feed.products[1].variants[0].price).toBe(1200);
  });

  it('leaves out items without a price and says so', () => {
    expect(feed.itemCount).toBe(5);
    expect(feed.warnings).toContainEqual({ code: 'skipped_no_price', count: 1, examples: ['Шарф без ціни'] });
  });

  it('reads Atom feeds with any namespace prefix, grouping by title when there is no group id (a colour all variants share stays in the name)', () => {
    const atom = parseFeed('gmc', fixture('gmc-atom.xml'), NO_LIMIT);
    expect(atom.products).toHaveLength(1);
    expect(atom.products[0]).toMatchObject({ title: 'Футболка базова синя', metadata: { url: 'https://shop.example/t-shirt' } });
    expect(atom.products[0].variants.map((v) => [v.color, v.size])).toEqual([
      ['Синій', 'S'],
      ['Синій', 'M'],
    ]);
    expect(atom.warnings).toContainEqual(expect.objectContaining({ code: 'no_group_id', count: 2 }));
  });
});

describe('parseFeed — YML', () => {
  const feed = parseFeed('yml', fixture('yml-prom.xml'), NO_LIMIT);
  const dress = feed.products.find((p) => p.externalProductId === 'feed:50')!;

  it('groups offers by group_id and reads colour and size from params', () => {
    expect(dress.title).toBe('Сукня міді червона');
    expect(dress.variants.map((v) => [v.color, v.size, v.inventoryQty])).toEqual([
      ['Червоний', 'S', 3],
      ['Червоний', 'M', 0],
    ]);
  });

  it('treats oldprice as the regular price and price as the sale price', () => {
    expect(dress.variants[0]).toMatchObject({ price: 1999, salePrice: 1499, sku: 'DR-50' });
  });

  it('uses the category name, the Ukrainian description and the brand', () => {
    expect(dress).toMatchObject({ categories: ['Сукні'], brand: 'Mango', description: 'Сукня міді з віскози' });
    expect(feed.products.find((p) => p.title === 'Шарф кашемір')?.categories).toEqual(['Одяг']);
  });
});

describe('parseFeed — Google Sheet template', () => {
  const feed = parseFeed('sheet', fixture('sheet.csv'), NO_LIMIT);

  it('groups rows by «Артикул», one variant per colour and size', () => {
    const shirt = feed.products.find((p) => p.externalProductId === 'feed:SH-1')!;
    expect(shirt.title).toBe('Сорочка льон');
    expect(shirt.variants.map((v) => [v.color, v.size, v.price, v.salePrice, v.inventoryQty])).toEqual([
      ['Білий', 'M', 3300, null, 5],
      ['Білий', 'L', 3300, null, 0],
      ['Чорний', 'M', 3300, 2900, 1],
    ]);
    expect(shirt.images?.map((i) => i.url)).toEqual(['https://cdn.example/a.jpg', 'https://cdn.example/b.jpg', 'https://cdn.example/c.jpg']);
    expect(shirt.description).toBe('Легка сорочка, льон');
  });

  it('falls back to the title as id, with a warning, and treats an empty stock cell as in stock', () => {
    const trousers = feed.products.find((p) => p.title === 'Брюки льон')!;
    expect(trousers.externalProductId).toBe('feed:брюки-льон');
    expect(trousers.variants[0].inventoryQty).toBe(1);
    expect(feed.warnings).toContainEqual({ code: 'no_article', count: 1 });
    expect(feed.warnings).toContainEqual(expect.objectContaining({ code: 'skipped_no_price', count: 1 }));
  });
});

describe('finishing products', () => {
  it('stops at the plan limit and reports how many were left out', () => {
    const feed = parseFeed('gmc', fixture('gmc-rss.xml'), { maxProducts: 1 });
    expect(feed.products).toHaveLength(1);
    expect(feed.warnings).toContainEqual({ code: 'over_limit', count: 1 });
  });

  it('drops a barcode two variants share', () => {
    const csv = 'Артикул,Товар,Ціна,Розмір\nA,Шапка,500,S\nA,Шапка,500,M\n';
    const xml = fixture('gmc-rss.xml').replace('<g:size>L</g:size>', '<g:size>L</g:size><g:gtin>4820000000011</g:gtin>');
    const feed = parseFeed('gmc', xml, NO_LIMIT);
    expect(feed.products[0].variants.map((v) => v.barcode)).toEqual([null, null, null]);
    expect(feed.warnings).toContainEqual(expect.objectContaining({ code: 'duplicate_barcodes' }));
    expect(parseFeed('sheet', csv, NO_LIMIT).products[0].variants).toHaveLength(2);
  });
});

describe('feed helpers', () => {
  it.each([
    ['3300.00 UAH', 3300, 'UAH'],
    ['1 299,50 грн', 1299.5, 'UAH'],
    ['1.299,50', 1299.5, null],
    ['1,299.50 USD', 1299.5, 'USD'],
    ['899', 899, null],
  ])('parses the price %s', (raw, amount, currency) => {
    expect(parsePrice(raw)).toEqual({ amount, currency });
  });

  it('turns HTML into plain text', () => {
    expect(plainText('<p>Склад:&nbsp;льон&amp;бавовна</p><ul><li>Прямий крій</li></ul>')).toBe('Склад: льон&бавовна\nПрямий крій');
  });

  it('turns Google Sheet links into their CSV export', () => {
    expect(feedUrl('https://docs.google.com/spreadsheets/d/abc123/edit#gid=42')).toBe(
      'https://docs.google.com/spreadsheets/d/abc123/export?format=csv&gid=42',
    );
    expect(feedUrl('https://docs.google.com/spreadsheets/d/e/2PACX-x/pubhtml')).toBe(
      'https://docs.google.com/spreadsheets/d/e/2PACX-x/pub?output=csv',
    );
    expect(feedUrl('https://shop.example/feed.xml')).toBe('https://shop.example/feed.xml');
  });

  it('detects the format from the content', () => {
    expect(detectFormat(fixture('gmc-rss.xml'))).toBe('gmc');
    expect(detectFormat(fixture('gmc-atom.xml'))).toBe('gmc');
    expect(detectFormat(fixture('yml-prom.xml'))).toBe('yml');
    expect(detectFormat(fixture('sheet.csv'), 'text/csv')).toBe('sheet');
    expect(detectFormat('<!DOCTYPE html><html><body>Sign in</body></html>')).toBeNull();
  });

  it('reads quoted CSV fields with commas, quotes and line breaks', () => {
    expect(parseCsv('a,"b, c","say ""hi""","line\nbreak"\r\nx,y,,z')).toEqual([
      ['a', 'b, c', 'say "hi"', 'line\nbreak'],
      ['x', 'y', '', 'z'],
    ]);
  });
});
