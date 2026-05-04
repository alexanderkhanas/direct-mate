/**
 * Display-format an ISO currency code for the customer-facing reply.
 * DB stores `UAH` (ISO 4217) but Ukrainian customers expect `грн`.
 * Other codes pass through unchanged so future markets work without
 * additional mapping until we localize them too.
 */
export function formatCurrency(code: string | null | undefined): string {
  if (!code) return '';
  if (code === 'UAH') return 'грн';
  return code;
}

/**
 * Sort clothing sizes in their natural ascending order. Letter sizes follow
 * the canonical XXS → XS → S → M → L → XL → XXL → XXXL chain. Numeric
 * waist/age sizes (`W26`, `26`, `36`) sort by their numeric component.
 * Unknown labels fall back to lexicographic order, sorted after any
 * recognized labels so the structured ones lead the list.
 *
 * Returns a new array — non-mutating, safe to call on a deduped Set.
 */
const SIZE_ORDER: Record<string, number> = {
  XXS: 0, XS: 1, S: 2, M: 3, L: 4, XL: 5, XXL: 6, XXXL: 7, '4XL': 8, '5XL': 9,
};

export function sortSizes(sizes: string[]): string[] {
  return [...sizes].sort((a, b) => {
    const ua = a.toUpperCase().trim();
    const ub = b.toUpperCase().trim();
    const ra = SIZE_ORDER[ua];
    const rb = SIZE_ORDER[ub];
    if (ra !== undefined && rb !== undefined) return ra - rb;
    if (ra !== undefined) return -1;
    if (rb !== undefined) return 1;
    // Numeric extraction (handles "W26", "36", "EU40", etc.)
    const na = parseInt(ua.replace(/[^0-9]/g, ''), 10);
    const nb = parseInt(ub.replace(/[^0-9]/g, ''), 10);
    if (!isNaN(na) && !isNaN(nb)) return na - nb;
    if (!isNaN(na)) return -1;
    if (!isNaN(nb)) return 1;
    return ua.localeCompare(ub);
  });
}
