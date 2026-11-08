/**
 * Strips personal data from chat text before it reaches a model: phones,
 * emails, card and account numbers, Nova Poshta branch and locker numbers,
 * postcodes, street addresses, and the names of the people in the
 * conversation. Each becomes a short token («[телефон]»), so the sentence
 * still reads naturally; a name after a greeting or thanks is dropped
 * («Дякую, Олено!» → «Дякую!»). Prices, sizes, dates and times are left alone.
 */

export const REDACTED = {
  phone: '[телефон]',
  email: '[email]',
  card: '[картка]',
  number: '[номер]',
  iban: '[рахунок]',
  address: '[адреса]',
  name: "[ім'я]",
  /** A customer message that was delivery details (name, phone, branch, address): nothing to learn from it. */
  delivery: '[дані для доставки]',
} as const;

/** Tokens that mean a customer message was giving delivery or payment details. */
const DELIVERY_TOKENS: readonly string[] = [REDACTED.phone, REDACTED.email, REDACTED.card, REDACTED.number, REDACTED.iban, REDACTED.address];

const EMAIL = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+/gu;

/** UA + 27 digits, written solid or in groups. */
const IBAN = /(?<![\p{L}\p{N}])UA(?:\s?\d){27}(?!\d)/giu;

/** 13–19 digits, solid or in groups of four (Amex: 4-6-5). Card or not is decided by the Luhn check. */
const LONG_NUMBER = /(?<![\d])(?:\d{13,19}|\d{4}(?:[ -]\d{4}){2}(?:[ -]\d{1,4}){1,2}|\d{4}[ -]\d{6}[ -]\d{5})(?![\d])/g;

/**
 * Ukrainian phones: +380 67 123 45 67, 380671234567, +38 (067) 123-45-67,
 * 067 123 45 67, 067 12 34 567, (067)1234567, 0671234567: the operator code,
 * then seven digits grouped any way. A local number must start with 0, which
 * keeps prices («1 200 000 грн») out.
 */
const PHONE = /(?<![\d+])(?:\+?380[\s-]?\(?\d{2}\)?|(?:\+?38[\s-]?)?\(?0\d{2}\)?)(?:[\s-]?\d){7}(?!\d)/g;

/** Any other international number: «+» and 9–15 digits («+48 512 345 678»). */
const INTL_PHONE = /(?<![\d+])\+(?:\d[\s().-]{0,2}){8,14}\d(?!\d)/g;

/** A street address with its house (and flat) number: «вул. Шевченка 12, кв. 5», «просп. Перемоги 3/1». */
const ADDRESS =
  /(?<![\p{L}])(?:вулиця|вул\.?|проспект|просп\.?|пр-т|провулок|пров\.?|бульвар|бульв\.?|б-р|площа|пл\.|шосе|узвіз|набережна|наб\.?)\s*[\p{L}'’ʼ.\- ]{2,40}?,?\s*\d+\p{L}?(?:\s*,?\s*(?:будинок|буд\.?|квартира|кв\.?|корпус|корп\.?|під'їзд)\s*\d+\p{L}?|\/\d+\p{L}?)*/giu;

/**
 * A Nova Poshta branch or parcel locker, or an Ukrposhta postcode: the word
 * stays, the number goes («відділення №123» → «відділення [номер]»). A number
 * followed by a duration, a price or a range («Нова Пошта 1–2 дні») is not a
 * branch.
 */
const BRANCH =
  /(?<![\p{L}])(відділенн\p{L}*|відд?\.|нов(?:а|ої|у|ій|ою)\s+пошт\p{L}*|нп|поштомат\p{L}*|укрпошт\p{L}*|індекс)\s*(?:№|#|no\.?)?\s*\d{1,5}(?![\d\p{L}])(?!\s*(?:[-–—]\s*\d|дн|день|дня|днів|доб|год|тиж|міс|грн|₴|%|хв|шт|кг|см|раз))/giu;

/** A capitalised Cyrillic word, or a name already replaced. */
const NAME_WORD = "(?:\\[ім'я\\]|[А-ЯІЇЄҐ][а-яіїєґ'’ʼ]+)";

/** Two or three capitalised words in a row: a full name («Іваненко Олена Петрівна»). */
const FULL_NAME = new RegExp(`(?<![\\p{L}'’ʼ])${NAME_WORD}(?:[ \\t]+${NAME_WORD}){1,2}(?![\\p{L}])`, 'gu');

/** Capitalised words that aren't names: polite pronouns, greetings, words a sentence starts with («Дякую Вам», «Це [ім'я]»). */
const NOT_NAMES = new Set([
  'Ви', 'Вам', 'Вас', 'Вами', 'Ваш', 'Ваша', 'Ваше', 'Ваші', 'Вашого', 'Вашої', 'Вашу', 'Вашим', 'Ваших',
  'Дякую', 'Дякуємо', 'Добрий', 'Доброго', 'День', 'Вітаю', 'Вітаємо', 'Привіт', 'Так', 'Ні', 'Будь', 'Ласка',
  'Це', 'Ми', 'Мені', 'Мене', 'Мій', 'Моя', 'Моє', 'Мої', 'Ось', 'Ще', 'Чи', 'Як', 'Коли', 'Де', 'Що', 'Скільки',
  'Є', 'Можна', 'Хочу', 'Скажіть', 'Підкажіть', 'Отримувач', 'Замовлення',
]);

/** Carriers written in capitals («Нова Пошта») aren't names. */
const CARRIER = /нов\p{L}*\s+пошт\p{L}*|укр\s*пошт\p{L}*|meest\p{L}*/giu;

const GREETINGS = [
  'дякую', 'дякуємо', 'спасибі', 'привіт', 'вітаю', 'вітаємо', 'добрий день', 'добрий ранок', 'добрий вечір',
  'доброго дня', 'доброго ранку', 'доброго вечора', 'здрастуйте', 'здравствуйте', 'гарного дня', 'гарного вечора',
  'до побачення', 'до зустрічі', 'чекаємо',
];

/** A greeting or thanks followed by a name and nothing else («Дякую, Олено!»): the name goes, the greeting stays. */
const VOCATIVE = new RegExp(
  `(${GREETINGS.map((g) => `[${g[0].toUpperCase()}${g[0]}]${g.slice(1).replace(/ /g, '\\s+')}`).join('|')}),?\\s+(${NAME_WORD}(?:\\s+${NAME_WORD})?)(?=\\s*(?:[!.?…,)]|$))`,
  'gmu',
);

const CYRILLIC = /^[\p{Script=Cyrillic}'’ʼ-]+$/u;
/** Endings dropped to get a name's stem, so its other forms match too («Олена» → «Олено», «Оленою»). */
const SOFT_ENDING = /[аяоеєіїиуюьй]+$/iu;

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Luhn checksum: tells a card number from an order or parcel number. */
function luhn(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

/**
 * The patterns for the people in a conversation: each username as written
 * (with or without @), each full name, and each part of it. Ukrainian names
 * decline, so a Cyrillic part of four letters or more matches by its stem.
 */
function namePattern(names: readonly string[]): RegExp | null {
  const alternatives = new Set<string>();
  for (const raw of names) {
    const name = raw?.trim().replace(/^@/, '');
    if (!name || name.length < 2) continue;
    alternatives.add(escape(name));
    for (const part of name.split(/\s+/)) {
      if (part.length < 3) continue;
      const stem = part.replace(SOFT_ENDING, '');
      alternatives.add(CYRILLIC.test(part) && stem.length >= 4 ? `${escape(stem)}\\p{L}{0,3}` : escape(part));
    }
  }
  if (alternatives.size === 0) return null;
  // Longest first, so a full name wins over its parts.
  const sorted = [...alternatives].sort((a, b) => b.length - a.length);
  return new RegExp(`(?<![\\p{L}\\p{N}_.@])@?(?:${sorted.join('|')})(?![\\p{L}\\p{N}_])`, 'giu');
}

/** `text` with personal data replaced by tokens. `names` are the conversation's participants (usernames and names). */
export function redact(text: string, names: readonly string[] = []): string {
  let out = text
    .replace(EMAIL, REDACTED.email)
    .replace(IBAN, REDACTED.iban)
    .replace(LONG_NUMBER, (match) => (luhn(match.replace(/\D/g, '')) ? REDACTED.card : REDACTED.number))
    .replace(PHONE, REDACTED.phone)
    .replace(INTL_PHONE, REDACTED.phone)
    .replace(ADDRESS, REDACTED.address)
    .replace(BRANCH, (_match, word: string) => `${word} ${REDACTED.number}`);
  const people = namePattern(names);
  if (people) out = out.replace(people, REDACTED.name);
  // «Дякую Вам!» keeps its «Вам».
  return out.replace(VOCATIVE, (match, greeting: string, name: string) =>
    name.split(/\s+/).every((word) => NOT_NAMES.has(word)) ? match : greeting,
  );
}

/** Two or three capitalised words in a row that look like a person's name (carriers and «Дякую Вам» aside). */
export function hasFullName(text: string): boolean {
  const plain = text.replace(CARRIER, '');
  for (const match of plain.matchAll(FULL_NAME)) {
    // Two name-like words still next to each other once the ordinary words are taken out.
    let run = 0;
    for (const word of match[0].split(/\s+/)) {
      run = NOT_NAMES.has(word) ? 0 : run + 1;
      if (run >= 2) return true;
    }
  }
  return false;
}

/**
 * A customer's message, redacted. One that carries delivery or payment
 * details (a phone, branch, card, address, or a full name) becomes
 * «[дані для доставки]» as a whole: it has nothing to teach about tone.
 */
export function redactCustomer(text: string, names: readonly string[] = []): string {
  const out = redact(text, names);
  return DELIVERY_TOKENS.some((token) => out.includes(token)) || hasFullName(out) ? REDACTED.delivery : out;
}

/** True when the text still holds something `redact` would have taken out, one of its tokens, or a full name. */
export function hasPersonalData(text: string): boolean {
  return Object.values(REDACTED).some((token) => text.includes(token)) || redact(text) !== text || hasFullName(text);
}
