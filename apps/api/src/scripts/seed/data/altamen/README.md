# Alta Men — scraped catalog (lead demo)

Source: https://altamen.com.ua/ (OpenCart), scraped 2026-07-31 from the
public sitemap + product pages. Read-only GET requests, throttled to
1 request / 1.5s. The lead has not granted store access — this data is
for the demo tenant only.

## Files

- `altamen-products.json` — 266 products / 1169 variants in a
  `ProductSpec`-compatible shape (see `../types.ts`) plus extra fields
  (`sku`, `sourceUrl`, `imageUrls`, `sizeOptionLabel`, `currency`).
  NOT applied to any DB yet.
- `altamen-raw-scrape.json` — full parse output per page (JSON-LD
  fields, breadcrumb category, description variants) for the
  enrichment step.
- `altamen-products-enriched.json` — the file to seed from. Same
  shape as `altamen-products.json` plus: `description` rewritten
  per-product (Claude vision analysis of the main photo, 2026-07-31),
  original site text preserved as `originalDescription`,
  `attributes: {fabric, fit, details[]}` extracted from the photo,
  and `variants[].color` filled with the visually-derived Ukrainian
  color (products are one-per-color, so all variants of a product
  share it).

## Data semantics — read before seeding

- **Per-size stock**: the theme renders ONLY in-stock sizes (size sets
  vary per product, incl. mid-run gaps like `M, L, 2XL`). A rendered
  size = in stock; quantity is NOT exposed, so every variant carries a
  placeholder `stock: 5`. Fully sold-out products are absent from the
  sitemap entirely — all 266 products are "В наявності".
- **Color**: Alta Men models one product per color (color is in the
  title, e.g. «Сорочка льон блакитна»); variants are size-only. In
  `altamen-products.json` color is `null`; in
  `altamen-products-enriched.json` it is filled from image analysis
  (35 distinct Ukrainian color names, e.g. Бежевий, Темно-синій,
  Сірий меланж).
- **Sizes**: apparel uses `S…XL, 2XL, 3XL` (also `XXL` on 12 older
  products — same size, different notation); shoes (`Взуття`, 37
  products) use numeric `40–45`. Note `2XL/3XL` are not in the
  classifier's informal canonical size list (S–XL + numeric).
- **Descriptions**: only 116 unique texts across 266 products — 199
  products share a generic per-category blurb. Enrichment planned.
- **Images**: URLs only (830 total, ~3 per product), not downloaded.
- `externalId` is `altamen-<slug>` (their SKU `model` codes have at
  least one duplicate: `542402`).
