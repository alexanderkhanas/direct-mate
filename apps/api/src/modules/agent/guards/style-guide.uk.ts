/**
 * Ukrainian style rules, shared by the system prompt (so the model knows them)
 * and the style guard (so a slip is caught before sending). Extend both by
 * adding a rule here.
 *
 * Patterns use Unicode lookarounds because JS `\b` only knows ASCII letters.
 * The lookbehind also excludes apostrophes, or «з'являється» (appears, correct
 * Ukrainian) would match the «являється» rule.
 */

export interface StyleRule {
  id: string;
  pattern: RegExp;
  wrong: string;
  right: string;
}

const START = "(?<![\\p{L}'’ʼ])";
const END = '(?!\\p{L})';

function rule(id: string, source: string, wrong: string, right: string): StyleRule {
  return { id, pattern: new RegExp(`${START}(?:${source})${END}`, 'iu'), wrong, right };
}

/** Classic russisms, from the decisions doc (Decision 7). */
export const RUSSISMS: StyleRule[] = [
  rule('na_protiazi', 'на\\s+протязі', 'на протязі', 'протягом'),
  rule('pryimaty_uchast', 'прийма\\p{L}*\\s+участ\\p{L}*', 'приймати участь', 'брати участь'),
  rule('vybachaius', 'вибачаю(?:сь|ся)', 'вибачаюсь', 'перепрошую'),
  rule('sliduiuchyi', 'слідуюч\\p{L}*', 'слідуючий', 'наступний'),
  rule('iavliaietsia', 'явля\\p{L}*с[яь]', 'являється', 'є'),
  rule('po_rozmiru', 'по\\s+розміру', 'по розміру', 'за розміром'),
];

/** Bureaucratic openers that make a DM read like a call centre. */
export const BANNED_PHRASES: StyleRule[] = [
  rule(
    'thanks_for_contacting',
    'дякуємо\\s+за\\s+(?:ваше\\s+)?звернення',
    'Дякуємо за ваше звернення',
    'answer straight away',
  ),
  rule('how_can_i_help', 'чим\\s+(?:я\\s+)?можу\\s+(?:вам\\s+)?допомогти', 'Чим можу допомогти?', '«Підкажіть, що шукаєте?»'),
];
