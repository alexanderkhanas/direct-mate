import { formatCurrency } from '../../../common/format';

// Customers and catalogs write extra-large sizes both ways ("XXL" / "2XL").
const SIZE_ALIASES: Record<string, string> = { XXL: '2XL', XXXL: '3XL', XXXXL: '4XL' };

/** Canonical size label for comparisons: upper case, "XXL" ≡ "2XL". */
export function normSize(size: string): string {
  const upper = size.trim().toUpperCase().replace(/\s+/g, '');
  return SIZE_ALIASES[upper] ?? upper;
}

export function sameSize(a: string | null | undefined, b: string | null | undefined): boolean {
  return !!a && !!b && normSize(a) === normSize(b);
}

// Letter sizes written in text. Upper case only: a lower-case "s" or "m" in a
// message is rarely a size. Apostrophes count as letters so "L'Oréal" isn't L.
const LETTER_SIZE = /(?<![\p{L}\d'’ʼ])(XXXL|XXL|XL|XXS|XS|[2-6]XL|S|M|L)(?![\p{L}\d'’ʼ])/gu;
const NUMERIC_SIZE = /розмір\p{L}*\s+(\d{2})(?!\d)|(?<!\d)(\d{2})(?:-?(?:й|ий|го|му))?\s+розмір/giu;

/** Sizes mentioned in free text: letter sizes, and two-digit sizes next to «розмір». */
export function findSizes(text: string): string[] {
  const sizes = [...text.matchAll(LETTER_SIZE)].map((m) => m[1]);
  for (const m of text.matchAll(NUMERIC_SIZE)) sizes.push(m[1] ?? m[2]);
  return sizes;
}

/** «3300 грн», «1299.50 грн». */
export function money(amount: number, currency: string): string {
  const value = Number.isInteger(amount) ? String(amount) : amount.toFixed(2);
  return `${value} ${formatCurrency(currency)}`.trim();
}
