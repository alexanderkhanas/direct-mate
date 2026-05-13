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
];
