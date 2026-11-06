/**
 * The price a customer pays for a variant: the sale price when the store set
 * one below the regular price, otherwise the regular price.
 *
 * One rule for every place a price appears — what the agent quotes, the
 * catalog index, and the unit price written into an order draft — so a quote
 * and an order can't disagree. (The old engine quoted and ordered the regular
 * price even when a discount was set.)
 */
export function effectivePrice(price: number, salePrice: number | null | undefined): number {
  return salePrice != null && salePrice < price ? salePrice : price;
}

/** The regular price when a discount applies, else null. */
export function regularPriceIfDiscounted(
  price: number,
  salePrice: number | null | undefined,
): number | null {
  return salePrice != null && salePrice < price ? price : null;
}
