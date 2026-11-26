/**
 * The plans as on the pricing page. The live prices and limits are in the API's
 * `subscription_plan_configs` (editable in the admin's Plan config): a change there needs a change here.
 */
export const PLAN_PRICES = {
  starter: 4099,
  professional: 6399,
  business: 7999,
} as const;

export type PlanId = keyof typeof PLAN_PRICES;

export const MIN_PRICE = Math.min(...Object.values(PLAN_PRICES));

/** 4099 → «4 099» (a no-break space between thousands, as Ukrainian writes it). */
export function uah(amount: number): string {
  return amount.toLocaleString('uk-UA').replace(/\s/g, ' ');
}

/** A plan's limits, after the API's columns. null = no limit. */
export interface PlanLimits {
  /** `conversation_limit`, a month. */
  conversations: number | null;
  /** `ig_accounts_limit`. */
  instagramAccounts: number;
  /** `products_limit`. */
  products: number | null;
  /** `connections_limit`: product sources. The API holds 99 for Business; the page says «без обмежень». */
  sources: number | null;
  /** `team_members_limit`. */
  users: number;
  /** `history_days`; 365 reads «рік». */
  historyDays: number;
}

export interface Plan {
  id: PlanId;
  name: string;
  /** Who it is for: the line under the name. */
  audience: string;
  /** UAH a month. */
  price: number;
  limits: PlanLimits;
}

export const PLANS: Plan[] = [
  {
    id: 'starter',
    name: 'Starter',
    audience: 'Для одного магазину з невеликим каталогом',
    price: PLAN_PRICES.starter,
    limits: { conversations: 1000, instagramAccounts: 1, products: 500, sources: 1, users: 1, historyDays: 30 },
  },
  {
    id: 'professional',
    name: 'Professional',
    audience: 'Для магазину з командою менеджерів',
    price: PLAN_PRICES.professional,
    limits: { conversations: 3000, instagramAccounts: 3, products: 2000, sources: 2, users: 3, historyDays: 90 },
  },
  {
    id: 'business',
    name: 'Business',
    audience: 'Для кількох брендів і великого каталогу',
    price: PLAN_PRICES.business,
    limits: { conversations: null, instagramAccounts: 10, products: null, sources: null, users: 5, historyDays: 365 },
  },
];

/** One line of a plan card; `value` (the number, or «без обмежень») is the bold part. */
export interface LimitLine {
  before: string;
  value: string;
  after: string;
}

const pluralRules = new Intl.PluralRules('uk');

/** The noun's form for n: 1 акаунт, 3 акаунти, 10 акаунтів. */
function plural(n: number, [one, few, many]: [string, string, string]): string {
  const form = pluralRules.select(n);
  return form === 'one' ? one : form === 'few' ? few : many;
}

const UNLIMITED = 'без обмежень';
const line = (before: string, value: string, after = ''): LimitLine => ({ before, value, after });

/** A plan's limits as the pricing page lists them: «1 000 розмов на місяць», «До 500 товарів», … */
export function limitLines(limits: PlanLimits): LimitLine[] {
  const { conversations, instagramAccounts, products, sources, users, historyDays } = limits;
  return [
    conversations === null
      ? line('Розмови ', UNLIMITED)
      : line('', uah(conversations), ` ${plural(conversations, ['розмова', 'розмови', 'розмов'])} на місяць`),
    line('', uah(instagramAccounts), ` ${plural(instagramAccounts, ['акаунт', 'акаунти', 'акаунтів'])} Instagram`),
    products === null ? line('Товари ', UNLIMITED) : line('До ', uah(products), ' товарів'),
    sources === null
      ? line('Джерела товарів ', UNLIMITED)
      : line('', uah(sources), ` ${plural(sources, ['джерело', 'джерела', 'джерел'])} товарів`),
    line('', uah(users), ` ${plural(users, ['користувач', 'користувачі', 'користувачів'])}`),
    line('Історія розмов: ', historyDays === 365 ? 'рік' : `${historyDays} ${plural(historyDays, ['день', 'дні', 'днів'])}`),
  ];
}
