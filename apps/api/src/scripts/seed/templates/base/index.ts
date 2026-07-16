// Base templates shared by all demo verticals (clothing, cosmetics, ...).
// These scenarios reference vertical-agnostic concepts (greeting, order
// confirmation, FAQ, checkout). Vertical packs may NOT override scenarios
// in this file unless content needs to differ — keep base universal.

import { TemplateSpec } from '../types';

export const BASE_TEMPLATES: TemplateSpec[] = [
  {
    scenario: 'greeting',
    stage: 'greeting',
    blocks: ['Вітаю 💛 Чим можу допомогти?'],
    requiredVariables: [],
    toneTags: ['warm'],
    priority: 90,
    active: true,
  },
  {
    scenario: 'confirm_order',
    stage: 'order_confirmation',
    blocks: ['Дякую 💛 Ваше замовлення:\n{order_summary}\n\nОчікуйте повідомлення про відправку!'],
    requiredVariables: ['order_summary'],
    toneTags: ['warm'],
    priority: 90,
    active: true,
  },
  {
    scenario: 'order_confirmed_ask_delivery',
    stage: 'checkout',
    blocks: ['Чудово 💛 Для оформлення напишіть:\n• ПІБ\n• Телефон\n• Місто та відділення НП'],
    requiredVariables: [],
    toneTags: ['warm'],
    priority: 90,
    active: true,
  },
  {
    scenario: 'collect_checkout_info',
    stage: 'checkout',
    blocks: ['Чудово 💛 Для оформлення напишіть, будь ласка:\n• ПІБ\n• Номер телефону\n• Місто та відділення Нової Пошти'],
    requiredVariables: [],
    toneTags: ['warm'],
    priority: 90,
    active: true,
  },
  {
    scenario: 'answer_delivery',
    stage: 'faq',
    blocks: ['Відправка здійснюється Новою Поштою. Зазвичай 1-3 дні після оформлення 💛'],
    requiredVariables: [],
    toneTags: ['warm'],
    priority: 90,
    active: true,
  },
  {
    scenario: 'answer_payment',
    stage: 'faq',
    blocks: ['Оплата при отриманні (накладений платіж) або передоплата на картку 💛'],
    requiredVariables: [],
    toneTags: ['warm'],
    priority: 90,
    active: true,
  },
  {
    scenario: 'product_not_found',
    stage: 'product_discovery',
    blocks: ['Зараз перевірю наявність і напишу вам 💛'],
    requiredVariables: [],
    toneTags: ['warm'],
    priority: 90,
    active: true,
  },
  {
    scenario: 'confirm_selection',
    stage: 'product_selection',
    blocks: ['{product_name} ({variant_name}), {price} — оформлюємо? 💛'],
    requiredVariables: ['product_name', 'variant_name', 'price'],
    toneTags: ['warm'],
    priority: 90,
    active: true,
  },
  {
    scenario: 'confirm_variant_available',
    stage: 'product_selected',
    blocks: ['{product_name} — {price}\nТак, {variant_name} є в наявності, бажаєте замовити? 💛'],
    requiredVariables: ['product_name', 'price', 'variant_name', 'variant_type'],
    toneTags: ['warm'],
    priority: 90,
    active: true,
  },
  {
    scenario: 'confirm_selection_last_in_stock',
    stage: 'product_selected',
    blocks: [
      '{product_name} — {price} {variant_name} є, остання позиція в наявності 💛\nДодаємо до замовлення?',
    ],
    requiredVariables: ['product_name', 'price', 'variant_name'],
    toneTags: ['warm'],
    priority: 95,
    active: true,
  },
  {
    scenario: 'confirm_color_variant_in_stock',
    stage: 'product_selected',
    blocks: [
      '{product_name} — {color_variant} є в наявності\n' +
        'Розміри: {sizes}\n' +
        'Також є в інших кольорах: {other_colors_variants}\n' +
        'Бажаєте замовити?',
    ],
    requiredVariables: [
      'product_name',
      'color_variant',
      'sizes',
      'other_colors_variants',
    ],
    toneTags: ['warm'],
    priority: 95,
    active: true,
  },
  {
    scenario: 'ask_continue_or_checkout',
    stage: 'product_selection',
    blocks: ['{product_name} ({variant_name}) — додано 💛 Хочете ще щось, чи оформлюємо?'],
    requiredVariables: ['product_name'],
    toneTags: ['warm'],
    priority: 90,
    active: true,
  },
  {
    scenario: 'narrowing_no_match',
    stage: 'product_discovery',
    blocks: ['Серед показаних варіантів немає такого 💛 Пошукати ширше в каталозі?'],
    requiredVariables: [],
    toneTags: ['warm'],
    priority: 90,
    active: true,
  },
  {
    scenario: 'conversation_start_greeting',
    stage: 'greeting',
    blocks: ['Вітаю, з вами АІ асистент @directmate.app'],
    requiredVariables: [],
    toneTags: ['warm'],
    priority: 90,
    active: true,
  },
  {
    // Public reply posted under a product-question comment on a FEED post.
    // The real answer (price / availability / sizes / size chart) is sent
    // privately via DM; this short public reply just nudges the commenter to
    // their inbox. Store-configurable — tenants override via the admin panel.
    scenario: 'comment_public_reply',
    stage: 'greeting',
    blocks: ['Відповіли вам у дірект 💛'],
    requiredVariables: [],
    toneTags: ['warm'],
    priority: 90,
    active: true,
  },
  {
    // Opt-in: rendered by the engine's off-topic gate when a turn has no
    // product focus, no product entities, and no FAQ/template answer
    // («яка погода?», «ти бот?»). Tenants WITHOUT this template keep the
    // old behavior (AI fallback or handoff) — authoring it is what turns
    // the gate on. Keep it a polite steer back to the catalog.
    scenario: 'off_topic_redirect',
    stage: 'faq',
    blocks: [
      'Я найкраще допоможу з нашими товарами 💛 Підкажіть, що вас цікавить — і я покажу варіанти, ціни та розміри.',
    ],
    requiredVariables: [],
    toneTags: ['warm'],
    priority: 90,
    active: true,
  },
  {
    // The escalation notice, appended by `doHandoff` to EVERY handoff — an
    // explicit "can I talk to a human?", an allergy concern, a question the
    // catalog can't answer, a product we don't stock. Keep the copy neutral
    // enough to follow any of those: it may be appended to a context line
    // ("Секунду, уточню наявність 💛"), or stand alone. Engine falls back to
    // an identical hardcoded line for tenants that haven't authored one.
    scenario: 'handoff_ack',
    stage: 'faq',
    blocks: [
      'Передаю розмову менеджеру — він відповість вам тут найближчим часом 💛',
    ],
    requiredVariables: [],
    toneTags: ['warm'],
    priority: 90,
    active: true,
  },
  {
    // «Що у вас є?» — a browse that names nothing. Answers with the category
    // menu; the follow-up («футболки») then shows real product cards through
    // the normal path. A category list is the only answer that survives a
    // 282-product catalog, where five arbitrary items would read as broken.
    // Optional: the engine falls back to identical hardcoded copy.
    scenario: 'show_categories',
    stage: 'product_discovery',
    blocks: ['У нас є: {category_list} 💛 Що вас цікавить?'],
    requiredVariables: ['category_list'],
    toneTags: ['warm'],
    priority: 90,
    active: true,
  },
  {
    // The customer walked away from something mid-order, but the cart holds
    // more than one item and the classifier only ever tells us the product they
    // pivoted TO — never the one they cancelled. Ask rather than guess: deleting
    // the wrong item is worse than one extra turn.
    scenario: 'ask_cart_removal',
    stage: 'order_confirmation',
    blocks: ['Зараз у вашому замовленні:\n{cart_list}\n\nЩо саме прибрати? 💛'],
    requiredVariables: ['cart_list'],
    toneTags: ['warm'],
    priority: 90,
    active: true,
  },
];
