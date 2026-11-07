/**
 * What a new store starts with, before onboarding fills it in. The tone step
 * treats DEFAULT_BRAND_TONE as "not set yet".
 */
export const DEFAULT_BRAND_TONE = 'Привітно, коротко й по-людськи. Звертаємося на «ви».';

/** The AI disclosure the bot's first reply starts with; editable in Settings. */
export function defaultWelcomeLine(storeName: string): string {
  return `Вітаю! З вами AI-асистент магазину «${storeName.trim()}».`;
}
