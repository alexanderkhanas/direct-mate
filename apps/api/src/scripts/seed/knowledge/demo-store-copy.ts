// Fixed customer-facing lines for demo stores, read by the v2 agent's turn
// runner rather than written by the model. Wording comes from the template
// packs' conversation_start_greeting and handoff_ack.

/** First line of the bot's first reply in a conversation: the AI disclosure. */
export const DEMO_WELCOME_LINE = 'Вітаю, з вами AI-асистент @directmate.app';

export const DEMO_HANDOFF_ANNOUNCE =
  'Передаю розмову менеджеру — він відповість вам тут найближчим часом 💛';

/** Menswear voice: same line without the 💛 (brandConfig.disallowedPhrases). */
export const DEMO_HANDOFF_ANNOUNCE_NO_EMOJI =
  'Передаю розмову менеджеру — він відповість вам тут найближчим часом.';

/**
 * Sent verbatim by send_payment_details. Deliberately fake: a demo visitor
 * must never see real bank details or be able to pay.
 */
export const DEMO_PAYMENT_DETAILS = `Реквізити для передоплати:
Отримувач: ФОП Демо-магазин
IBAN: UA00 0000 0000 0000 0000 0000 0000 0
Призначення платежу: оплата замовлення, ваше ПІБ

Це демо-магазин, оплата не приймається.`;
