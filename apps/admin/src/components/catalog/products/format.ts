type Translate = (key: string, params?: Record<string, string | number>) => string;

/** «2 450 грн»; other currencies keep their code. */
export function formatPrice(price: number, currency: string, t: Translate): string {
  const amount = price.toLocaleString('uk-UA');
  return currency === 'UAH' ? `${amount} ${t('setup_products.uah')}` : `${amount} ${currency}`;
}

const LETTER_SIZES = ['XXXS', 'XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL', '4XL', '5XL'];

function sizeRank(size: string): number {
  const upper = size.trim().toUpperCase().replace(/^2XL$/, 'XXL').replace(/^3XL$/, 'XXXL');
  const letter = LETTER_SIZES.indexOf(upper);
  if (letter >= 0) return letter;
  const number = Number(upper.replace(',', '.'));
  return Number.isFinite(number) && upper !== '' ? 100 + number : NaN;
}

/** «XS–L» or «42–48» when every size is a known letter or a number; otherwise the list. */
export function sizeSummary(sizes: string[]): string {
  if (sizes.length <= 2 || sizes.some((s) => Number.isNaN(sizeRank(s)))) return sizes.join(', ');
  const sorted = [...sizes].sort((a, b) => sizeRank(a) - sizeRank(b));
  return `${sorted[0]}–${sorted[sorted.length - 1]}`;
}

/** «оновлено сьогодні о 14:20», «…вчора о 09:05», «…12 листопада о 14:20». */
export function syncedAt(iso: string, lang: 'uk' | 'en', t: Translate): string {
  const date = new Date(iso);
  const locale = lang === 'uk' ? 'uk-UA' : 'en-GB';
  const time = date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return t('setup_products.synced_today', { time });
  if (date.toDateString() === yesterday.toDateString()) return t('setup_products.synced_yesterday', { time });
  return t('setup_products.synced_on', { date: date.toLocaleDateString(locale, { day: 'numeric', month: 'long' }), time });
}
