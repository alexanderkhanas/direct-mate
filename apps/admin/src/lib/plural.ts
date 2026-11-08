import { useCallback } from 'react';
import { useT } from '../i18n';

export type PluralForm = 'one' | 'few' | 'many';

/** Ukrainian plural form: 1 товар · 2–4 товари · 5+ товарів (11–14 take «many»). English: one / many. */
export function pluralForm(n: number, lang: 'uk' | 'en'): PluralForm {
  const abs = Math.abs(Math.trunc(n));
  if (lang === 'en') return abs === 1 ? 'one' : 'many';
  const mod10 = abs % 10;
  const mod100 = abs % 100;
  if (mod10 === 1 && mod100 !== 11) return 'one';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'few';
  return 'many';
}

/**
 * `plural(64, 'setup_shell.products')` reads `setup_shell.products_few` and fills `{n}`.
 * Define all three keys (`_one`, `_few`, `_many`) in both languages; English uses `_one` and `_many`.
 */
export function usePlural() {
  const { t, lang } = useT();
  return useCallback(
    (n: number, keyBase: string, params?: Record<string, string | number>) =>
      t(`${keyBase}_${pluralForm(n, lang)}`, { n: n.toLocaleString(lang === 'uk' ? 'uk-UA' : 'en-US'), ...params }),
    [t, lang],
  );
}
