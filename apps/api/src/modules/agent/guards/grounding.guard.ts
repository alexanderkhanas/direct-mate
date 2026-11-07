import { colorsMatch, findColorWords } from '../../../common/color-i18n';
import { findSizes, normSize } from '../catalog/catalog-format';
import { stem } from '../catalog/catalog-search';
import { PROMPT_CANARY } from '../prompt/system-prompt';
import type { GroundingViolation } from '../agent.types';
import { PERCENT, type TurnFacts } from '../turn-facts';

/**
 * The grounding check (decisions doc, Decision 3): every price, size and
 * colour the reply states must match something a tool returned in this turn.
 * Allowed besides: numbers in the store notes (delivery costs, thresholds),
 * and anything the customer wrote themselves ("до 2000 грн", "а XL є?") —
 * repeating a customer's own words isn't a claim.
 *
 * It also checks claimed actions: "the order is placed" needs a place_order
 * this turn, and "I saved your details / added it" needs a successful
 * update_order_draft. These are the false claims that cost a customer — they
 * wait for a parcel, or think their details are on file.
 *
 * Promises: a discount, promo code, gift, bonus or "free" anything must be in
 * the store notes (or, for «знижка»/«акція», on a product a tool returned with
 * a crossed-out price), and every percentage must come from the notes or a
 * tool. These are what a customer talks a bot into and then screenshots. A
 * sentence that denies one («знижок, на жаль, немає») or asks a question
 * passes the word check; a percentage is checked regardless.
 *
 * Leaks: a reply that contains the prompt's canary is quoting the
 * instructions.
 *
 * What it can't catch: a wrong stock statement about a size or colour that
 * WAS returned ("L є" when the tool said L is out). That is left to the prompt
 * and the simulator's judge. It catches invented values, which is the failure
 * that costs money.
 */

const NUMBER = /\d{1,3}(?:[   ]\d{3})+|\d+/g;
// "The order is placed" / "I'm placing it". Questions and offers («оформлюємо?»,
// «можу оформити», «після оформлення») don't match.
const ORDER_PLACED =
  /(?<!\p{L})(?:оформ(?:ив|ила|или|лено|лене|лений|лена|люю|ляю)|замовлення\s+(?:прийнято|прийняте|створено|створене|оформлено))(?!\p{L})/iu;
// "I saved your details / added the item", in the past tense.
const DRAFT_SAVED =
  /(?<!\p{L})(?:записа(?:в|ла|ли|но)|зберіг|зберегла|зберегли|збережено|дода(?:в|ла|ли|но))(?!\p{L})/iu;
const PRICE = /(\d{1,3}(?:[   ]\d{3})+|\d+)(?:[.,](\d{1,2}))?\s*(?:грн|гривень|гривні|гривня|₴|uah)(?!\p{L})/giu;
// Promise words, by family: a store note mentioning one member allows the family.
const PROMISE_FAMILIES: Array<{ family: string; pattern: RegExp }> = [
  { family: 'discount', pattern: /(?<!\p{L})(?:знижк|знижок|скидк|discount)\p{L}*/iu },
  { family: 'promo', pattern: /(?<!\p{L})(?:промокод|промо-код|купон)\p{L}*/iu },
  { family: 'sale', pattern: /(?<!\p{L})(?:акці[йяїюі]|розпродаж)\p{L}*/iu },
  { family: 'free', pattern: /(?<!\p{L})(?:безкоштовн|безплатн|бесплатн|даремн)\p{L}*/iu },
  { family: 'gift', pattern: /(?<!\p{L})(?:подарун|подарок|подару[єю])\p{L}*/iu },
  { family: 'bonus', pattern: /(?<!\p{L})(?:бонус|кешбек|кешбэк|cashback)\p{L}*/iu },
];
const NEGATION = /(?<!\p{L})(?:не|немає|нема|ні|жодн\p{L}*|на жаль)(?!\p{L})/iu;

function parseNumber(raw: string): number {
  return Number(raw.replace(/[   ]/g, ''));
}

function allNumbers(text: string): number[] {
  return (text.match(NUMBER) ?? []).map(parseNumber);
}

/** At most one letter inserted, deleted or changed. */
function withinOneEdit(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (a.length < b.length) j++;
    else {
      i++;
      j++;
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

/**
 * A colour word that is a title word with its typo fixed. Catalogs misspell:
 * «Сорочка льон у гафітову смужку» is read back as «графітову», a real
 * colour, which no tool returned. Compared by stem so any case form matches.
 */
function correctsTitleWord(word: string, titles: string[]): boolean {
  const target = stem(word);
  if (target.length < 5) return false;
  return titles.some((t) => {
    const words: string[] = t.toLowerCase().match(/[\p{L}ʼ'’-]+/gu) ?? [];
    return words.some((w) => w.length >= 5 && withinOneEdit(stem(w), target));
  });
}

/** Product names say colours ("Футболка базова біла") without claiming stock. */
function withoutTitles(text: string, titles: string[]): string {
  let out = text;
  for (const title of [...titles].sort((a, b) => b.length - a.length)) {
    if (title.length < 3) continue;
    out = out.replace(new RegExp(title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), ' ');
  }
  return out;
}

export function checkGrounding(
  reply: string,
  facts: TurnFacts,
  allow: {
    customerText: string;
    knowledgeDoc: string | null;
    catalogTitles: string[];
    /** place_order was staged this turn, or the order was already placed before it. */
    orderPlaced: boolean;
    /** update_order_draft succeeded this turn. */
    draftUpdated: boolean;
  },
): GroundingViolation[] {
  const text = withoutTitles(reply, [...facts.titles, ...allow.catalogTitles]);
  const violations: GroundingViolation[] = [];

  // Actions: saying something was done must match a tool that did it. The
  // model has narrated both without calling anything.
  const placedClaim = text.match(ORDER_PLACED);
  if (placedClaim && !allow.orderPlaced) violations.push({ kind: 'order', value: placedClaim[0] });
  const savedClaim = text.match(DRAFT_SAVED);
  if (savedClaim && !allow.draftUpdated) violations.push({ kind: 'draft', value: savedClaim[0] });

  const allowedPrices = new Set([
    ...facts.prices.map((p) => Math.round(p * 100)),
    ...allNumbers(allow.knowledgeDoc ?? '').map((n) => n * 100),
    ...allNumbers(allow.customerText).map((n) => n * 100),
  ]);
  for (const m of text.matchAll(PRICE)) {
    const amount = parseNumber(m[1]) + (m[2] ? Number(`0.${m[2]}`) : 0);
    if (!allowedPrices.has(Math.round(amount * 100))) {
      violations.push({ kind: 'price', value: m[0].trim() });
    }
  }

  // A customer's "а 46 є?" names a size without the word «розмір»; any
  // two-digit number they typed counts as their own words.
  const customerTwoDigit = (allow.customerText.match(/(?<!\d)\d{2}(?!\d)/g) ?? []);
  const allowedSizes = new Set([...facts.sizes, ...[...findSizes(allow.customerText), ...customerTwoDigit].map(normSize)]);
  for (const size of new Set(findSizes(text))) {
    if (!allowedSizes.has(normSize(size))) violations.push({ kind: 'size', value: size });
  }

  const customerColors = findColorWords(allow.customerText).map((c) => c.color);
  // A product whose colour is in its name has variants with no colour; the
  // name itself, returned by a tool this turn, grounds it («білу футболку»).
  const titleColors = facts.titles.flatMap((t) => findColorWords(t).map((c) => c.color));
  const knownColors = [...facts.colors, ...customerColors, ...titleColors];
  const seenColors = new Set<string>();
  for (const { word, color } of findColorWords(text)) {
    if (seenColors.has(color)) continue;
    seenColors.add(color);
    if (!knownColors.some((known) => colorsMatch(known, color)) && !correctsTitleWord(word, facts.titles)) {
      violations.push({ kind: 'color', value: word });
    }
  }

  violations.push(...checkPromises(reply, facts, allow.knowledgeDoc ?? ''));
  if (reply.includes(PROMPT_CANARY)) violations.push({ kind: 'leak', value: PROMPT_CANARY });

  return violations;
}

function checkPromises(reply: string, facts: TurnFacts, notes: string): GroundingViolation[] {
  const violations: GroundingViolation[] = [];
  const offered = new Set(PROMISE_FAMILIES.filter((f) => f.pattern.test(notes)).map((f) => f.family));
  if (facts.onSale) offered.add('discount').add('sale');

  const seen = new Set<string>();
  for (const sentence of reply.split(/(?<=[.!?…])\s+|\n+/)) {
    if (NEGATION.test(sentence) || sentence.trim().endsWith('?')) continue;
    for (const { family, pattern } of PROMISE_FAMILIES) {
      const match = sentence.match(pattern);
      if (match && !offered.has(family) && !seen.has(family)) {
        seen.add(family);
        violations.push({ kind: 'promise', value: match[0] });
      }
    }
  }

  // «впевнені на 100%» is how the size rules offer a manager check; a «знижка
  // 100%» is still caught by the word check above.
  const allowedPercents = new Set([
    100,
    ...facts.percents,
    ...[...notes.matchAll(PERCENT)].map((m) => percentValue(m[1])),
  ]);
  for (const m of reply.matchAll(PERCENT)) {
    if (!allowedPercents.has(percentValue(m[1]))) violations.push({ kind: 'promise', value: m[0] });
  }
  return violations;
}

function percentValue(raw: string): number {
  return Number(raw.replace(',', '.'));
}
