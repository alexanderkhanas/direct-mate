/**
 * Render-side localization for `variant.color` strings.
 *
 * The catalog stores colors in whatever language the connector
 * delivered — Torgsoft / Shopify / OpenCart for clothing tenants
 * mostly emit Ukrainian, but Nanushka's English colors (Black, Pink,
 * Beige, Light Blue, Navy, Cream, Dark Blue) and pilot's cosmetic
 * shades (01 Fair, Vanilla, Espresso, Berry Red) leak through. When
 * those values are concatenated into otherwise-Ukrainian customer
 * replies the result is jarring ("Відтінки: Black") and breaks
 * scenario assertions like `replyContains: 'чорн'`.
 *
 * This module translates the stored value to a customer-facing
 * Ukrainian display form at render time. It does NOT mutate stored
 * values — connectors stay faithful to upstream feeds, and the
 * search-side `translateColor` (engine canonicalization for ILIKE
 * matching) keeps working on the raw stored form.
 *
 * Lookup is case-insensitive. Compound colors not in the explicit
 * map ("Black/Roses", "Sand/Honey", "and"-joined pairs) are split
 * on common separators and each token is localized independently.
 *
 * The map below was populated from the live distinct-color SQL
 * across all 6 tenants in dev (clothes-store, demo-women-clothes,
 * demo-cosmetics, luxe-space, pilot, test-clothes — 131 distinct
 * values). Extend with explicit entries when new feeds introduce
 * unmapped values.
 */

const COLOR_DISPLAY_UK: Record<string, string> = {
  // ─── Black / Чорний ──────────────────────────────────────────────
  black: 'Чорний',
  чорний: 'Чорний',
  чорна: 'Чорний',
  чорне: 'Чорний',
  чорні: 'Чорний',
  'classic black': 'Класичний чорний',

  // ─── White / Білий ───────────────────────────────────────────────
  white: 'Білий',
  білий: 'Білий',
  біла: 'Білий',
  біле: 'Білий',
  білі: 'Білий',

  // ─── Red / Червоний ──────────────────────────────────────────────
  red: 'Червоний',
  червоний: 'Червоний',
  червона: 'Червоний',
  червоне: 'Червоний',
  червоні: 'Червоний',

  // ─── Pink / Rose / Mauve ─────────────────────────────────────────
  pink: 'Рожевий',
  рожевий: 'Рожевий',
  рожева: 'Рожевий',
  рожеве: 'Рожевий',
  рожеві: 'Рожевий',
  'nude pink': 'Ніжно-рожевий',
  rose: 'Трояндовий',
  rosewood: 'Трояндовий',
  rosy: 'Рожевий',
  petal: 'Пелюстковий',
  трояндовий: 'Трояндовий',
  пелюстковий: 'Пелюстковий',
  mauve: 'Мальвовий',
  мальвовий: 'Мальвовий',

  // ─── Blue / Синій / Голубий ──────────────────────────────────────
  blue: 'Синій',
  синій: 'Синій',
  синя: 'Синій',
  синє: 'Синій',
  сині: 'Синій',
  navy: 'Темно-синій',
  'dark blue': 'Темно-синій',
  'light blue': 'Світло-синій',
  'medium blue': 'Синій',
  'paper blue': 'Світло-синій',
  'темно-синій': 'Темно-синій',
  'світло-синій': 'Світло-синій',
  блакитний: 'Блакитний',
  блакитна: 'Блакитний',
  блакитне: 'Блакитний',
  голубий: 'Блакитний',
  голуба: 'Блакитний',
  голубе: 'Блакитний',
  'небесно-блакитний': 'Небесно-блакитний',
  'синій денім': 'Синій денім',

  // ─── Green / Зелений / Olive / Khaki ─────────────────────────────
  green: 'Зелений',
  зелений: 'Зелений',
  зелена: 'Зелений',
  зелене: 'Зелений',
  зелені: 'Зелений',
  olive: 'Оливковий',
  оливковий: 'Оливковий',
  khaki: 'Хакі',
  хакі: 'Хакі',
  'темно-зелений': 'Темно-зелений',

  // ─── Yellow / Жовтий ─────────────────────────────────────────────
  yellow: 'Жовтий',
  жовтий: 'Жовтий',
  жовта: 'Жовтий',
  жовте: 'Жовтий',
  жовті: 'Жовтий',

  // ─── Beige / Cream / Sand ────────────────────────────────────────
  beige: 'Бежевий',
  бежевий: 'Бежевий',
  бежева: 'Бежевий',
  бежеве: 'Бежевий',
  бежеві: 'Бежевий',
  cream: 'Кремовий',
  'crème': 'Кремовий',
  кремовий: 'Кремовий',
  кремова: 'Кремовий',
  кремове: 'Кремовий',
  молочний: 'Молочний',
  пісочний: 'Пісочний',
  sand: 'Пісочний',
  oat: 'Вівсяний',
  stone: 'Каменевий',

  // ─── Brown / Taupe / Tan ─────────────────────────────────────────
  brown: 'Коричневий',
  коричневий: 'Коричневий',
  коричнева: 'Коричневий',
  коричневе: 'Коричневий',
  коричневі: 'Коричневий',
  'soft brown': 'Світло-коричневий',
  'black brown': 'Чорно-коричневий',
  'чорно-коричневий': 'Чорно-коричневий',
  'brown melange': 'Коричневий меланж',
  taupe: 'Тауп',
  тауп: 'Тауп',

  // ─── Grey / Anthracite / Graphite ────────────────────────────────
  grey: 'Сірий',
  gray: 'Сірий',
  сірий: 'Сірий',
  сіра: 'Сірий',
  сіре: 'Сірий',
  сірі: 'Сірий',
  'light grey': 'Світло-сірий',
  'сірий меланж': 'Сірий меланж',
  'світло-сірий': 'Світло-сірий',
  графітовий: 'Графітовий',
  anthracite: 'Антрацитовий',
  антрацитовий: 'Антрацитовий',

  // ─── Purple / Orange / Apricot ───────────────────────────────────
  purple: 'Фіолетовий',
  фіолетовий: 'Фіолетовий',
  фіолетова: 'Фіолетовий',
  фіолетове: 'Фіолетовий',
  orange: 'Помаранчевий',
  помаранчевий: 'Помаранчевий',
  помаранчева: 'Помаранчевий',
  помаранчеве: 'Помаранчевий',
  apricot: 'Абрикосовий',
  абрикосовий: 'Абрикосовий',

  // ─── Burgundy / Cherry / Berry ───────────────────────────────────
  burgundy: 'Бордовий',
  бордовий: 'Бордовий',
  бордова: 'Бордовий',
  бордове: 'Бордовий',
  cherry: 'Вишневий',
  вишневий: 'Вишневий',
  berry: 'Ягідний',
  'berry red': 'Ягідно-червоний',
  ягідний: 'Ягідний',
  'ягідно-червоний': 'Ягідно-червоний',

  // ─── Multicolor / patterns ───────────────────────────────────────
  multicolor: 'Мультиколор',
  мультиколор: 'Мультиколор',
  різнокольоровий: 'Різнокольоровий',
  // Pattern descriptor (not strictly a color but stored in color column)
  клітинка: 'Клітинка',

  // ─── Mixed / hyphenated Ukrainian feminine forms ─────────────────
  // The clothes-store catalog has a few feminine compound colors that
  // need explicit canonicalization to nominative-masculine form.
  'сіро-чорна': 'Сіро-чорний',
  'синьо-червона': 'Синьо-червоний',

  // ─── Cosmetics shade tones (pilot tenant — foundations, lipsticks) ──
  fair: 'Світлий',
  light: 'Світлий',
  medium: 'Середній',
  deep: 'Глибокий',
  tan: 'Засмаглий',
  porcelain: 'Порцеляновий',
  vanilla: 'Ванільний',
  honey: 'Медовий',
  caramel: 'Карамельний',
  espresso: 'Еспресо',
  bronze: 'Бронзовий',
  'light bronze': 'Світло-бронзовий',
  'medium bronze': 'Середньо-бронзовий',
  'deep bronze': 'Темно-бронзовий',
  translucent: 'Прозорий',
  clear: 'Прозорий',
  світлий: 'Світлий',
  середній: 'Середній',
  глибокий: 'Глибокий',
  засмаглий: 'Засмаглий',
  порцеляновий: 'Порцеляновий',
  ванільний: 'Ванільний',
  медовий: 'Медовий',
  карамельний: 'Карамельний',
  еспресо: 'Еспресо',
  прозорий: 'Прозорий',
  бронзовий: 'Бронзовий',

  // ─── Numbered cosmetics shade prefixes ───────────────────────────
  // Pilot mixes "01 Fair" + "01 Світлий" + "01 Porcelain" within the
  // same product line; localize each variant explicitly so output
  // is consistent regardless of which name made it through ingest.
  '01 fair': '01 Світлий',
  '01 light': '01 Світлий',
  '01 porcelain': '01 Порцеляновий',
  '01 світлий': '01 Світлий',
  '01 порцеляновий': '01 Порцеляновий',
  '02 light': '02 Світлий',
  '02 vanilla': '02 Ванільний',
  '02 світлий': '02 Світлий',
  '02 ванільний': '02 Ванільний',
  '03 medium': '03 Середній',
  '03 sand': '03 Пісочний',
  '03 beige': '03 Бежевий',
  '03 середній': '03 Середній',
  '03 пісочний': '03 Пісочний',
  '03 бежевий': '03 Бежевий',
  '04 honey': '04 Медовий',
  '04 sand': '04 Пісочний',
  '04 tan': '04 Засмаглий',
  '04 медовий': '04 Медовий',
  '04 пісочний': '04 Пісочний',
  '04 засмаглий': '04 Засмаглий',
  '05 caramel': '05 Карамельний',
  '05 deep': '05 Глибокий',
  '05 tan': '05 Засмаглий',
  '05 карамельний': '05 Карамельний',
  '05 глибокий': '05 Глибокий',
  '05 засмаглий': '05 Засмаглий',
  '06 espresso': '06 Еспресо',
  '06 deep': '06 Глибокий',
  '06 еспресо': '06 Еспресо',
  '06 глибокий': '06 Глибокий',

  // ─── Demo cosmetics — skincare function descriptors (stored in color col) ──
  // demo-cosmetics tenant uses `variants.color` semantically to mean
  // "skin function" (mask type). Already in Ukrainian; idempotent.
  освітлююча: 'Освітлююча',
  очищувальна: 'Очищувальна',
  зволожуюча: 'Зволожуюча',
};

// Separators recognized inside compound colors. Keeping the captured
// group lets us round-trip the original separator on output
// ("Black/Roses" → "Чорний/Трояндовий").
const SEPARATOR_REGEX = /([\/&,]+|\s+(?:and|&|та)\s+)/i;

/**
 * Localize a single stored color string to its preferred Ukrainian
 * display form (nominative). Empty / null / undefined input → empty
 * string. Unmapped input → returned verbatim (acceptable fallback).
 *
 * For compound forms ("Black/Roses", "Sand and Honey") the function
 * first tries an explicit map entry; if absent, splits on separators
 * and localizes each token independently before rejoining with the
 * original separator.
 */
export function localizeColor(raw: string | null | undefined): string {
  if (!raw) return '';
  const trimmed = String(raw).trim();
  if (!trimmed) return '';

  // 1. Direct case-insensitive lookup — covers simple cases AND
  //    compounds that have explicit map entries.
  const direct = COLOR_DISPLAY_UK[trimmed.toLowerCase()];
  if (direct) return direct;

  // 2. Tokenized fallback for unmapped compounds.
  const parts = trimmed.split(SEPARATOR_REGEX);
  const anyMapped = parts.some(
    (part) => COLOR_DISPLAY_UK[part.toLowerCase().trim()] !== undefined,
  );
  if (!anyMapped) {
    // No token in this string maps — return verbatim.
    return trimmed;
  }
  return parts
    .map((part) => {
      if (SEPARATOR_REGEX.test(part)) return part;
      const key = part.toLowerCase().trim();
      if (!key) return part;
      return COLOR_DISPLAY_UK[key] ?? part;
    })
    .join('');
}

/**
 * Localize a list of color strings and join with `separator`.
 * Filters falsy values out of the result. Used for multi-color
 * carousel rendering ("Чорний, Білий, Бежевий").
 */
export function localizeColorList(
  raws: Array<string | null | undefined>,
  separator = ', ',
): string {
  return raws.map(localizeColor).filter(Boolean).join(separator);
}
