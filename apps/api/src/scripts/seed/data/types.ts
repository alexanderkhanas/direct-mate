// Shared catalog spec types used by per-vertical product data files
// (clothing-women-products.ts, cosmetics-products.ts, future verticals).

export interface VariantSpec {
  color: string | null;
  size: string | null;
  price: number;
  stock: number;
  /**
   * Optional variant-level image filename (relative to the vertical's
   * test-assets subdir). When omitted, the parent product's first image
   * is used. Cosmetics uses this for masks (3 different scents) and SPF
   * variants (different SPF levels).
   */
  imageFile?: string;
}

export interface ProductSpec {
  externalId: string;
  title: string;
  brand: string;
  category: string;
  description: string;
  /**
   * Default product image filename (relative to the vertical's test-assets
   * subdir). Used for product_media inserts when a variant doesn't override.
   */
  imageFile?: string;
  variants: VariantSpec[];
}
