// Men's-clothing template pack (demo-altamen / ÁLTA MEN).
//
// Same scenario set as base + clothing, rewritten in a restrained
// premium-menswear voice: no 💛 anywhere, emoji used sparingly (👌 / 🔥),
// shorter sentences, no diminutives. This is a FULL pack — it does not
// inherit from CLOTHING_TEMPLATES, because nearly every string there
// carries 💛 and a partial override would let the heart leak back in via
// any scenario added to the clothing pack later.
//
// `assertNoHearts` below enforces that at module load, so a copy/paste
// from the women's pack fails loudly instead of shipping to a demo.

import { TemplateSpec } from '../types';

export const CLOTHING_MEN_TEMPLATES: TemplateSpec[] = [
  // ─── Greeting / meta ────────────────────────────────────────────
  {
    scenario: 'conversation_start_greeting',
    stage: 'greeting',
    blocks: ['Вітаю, з вами AI-асистент @directmate.app'],
    requiredVariables: [],
    toneTags: ['confident'],
    priority: 90,
    active: true,
  },
  {
    scenario: 'greeting',
    stage: 'greeting',
    blocks: ['Вітаю. Чим можу допомогти?'],
    requiredVariables: [],
    toneTags: ['confident'],
    priority: 90,
    active: true,
  },
  {
    scenario: 'comment_public_reply',
    stage: 'greeting',
    blocks: ['Відповіли вам у дірект'],
    requiredVariables: [],
    toneTags: ['confident'],
    priority: 90,
    active: true,
  },
  {
    scenario: 'off_topic_redirect',
    stage: 'faq',
    blocks: [
      'Найкраще допоможу з нашим асортиментом. Підкажіть, що вас цікавить — покажу моделі, ціни та розміри.',
    ],
    requiredVariables: [],
    toneTags: ['confident'],
    priority: 90,
    active: true,
  },
  {
    scenario: 'handoff_ack',
    stage: 'faq',
    blocks: ['Передаю розмову менеджеру — він відповість вам тут найближчим часом.'],
    requiredVariables: [],
    toneTags: ['confident'],
    priority: 90,
    active: true,
  },

  // ─── Discovery ──────────────────────────────────────────────────
  {
    scenario: 'show_categories',
    stage: 'product_discovery',
    blocks: ['У нас є: {category_list}. Що вас цікавить?'],
    requiredVariables: ['category_list'],
    toneTags: ['confident'],
    priority: 90,
    active: true,
  },
  {
    scenario: 'show_products',
    stage: 'product_discovery',
    blocks: ['Ось що є в наявності:\n\n{product_list}'],
    requiredVariables: ['product_list'],
    toneTags: ['confident'],
    priority: 90,
    active: true,
  },
  {
    // Optional variant of show_products, rendered instead of it whenever
    // `memory.recommendedSize` is set. The list is ALREADY scoped to that size
    // by then — the search prunes variants to it and the size column is
    // suppressed — so the plain header dropped the one fact that explains why
    // the list looks the way it does. Unauthored → the plain list renders.
    scenario: 'show_products_with_size',
    stage: 'product_discovery',
    blocks: ['Ось що є в наявності для розміру {size}:\n\n{product_list}'],
    requiredVariables: ['size', 'product_list'],
    toneTags: ['confident'],
    priority: 90,
    active: true,
  },
  {
    scenario: 'show_price',
    stage: 'product_discovery',
    blocks: ['{product_name} — {price}'],
    requiredVariables: ['product_name', 'price'],
    toneTags: ['confident'],
    priority: 90,
    active: true,
  },
  {
    // Price + variant offer in one bubble. No {variant_type}: on a
    // two-axis product the list renders grouped («Хакі: S, M, L») while
    // detectVariantType reports a single axis — an axis-free lead-in
    // stays correct for both catalog shapes.
    scenario: 'show_price_with_variants',
    stage: 'product_discovery',
    blocks: ['{product_name} — {price}\nВ наявності: {variant_list}\nЩо вам підходить?'],
    requiredVariables: ['product_name', 'price', 'variant_list'],
    toneTags: ['confident'],
    priority: 90,
    active: true,
  },
  {
    scenario: 'recommend_product',
    stage: 'product_discovery',
    // A QUESTION, not a statement. The engine pre-selects the recommended
    // product (`updateMemoryFromAction` case 'recommend'), so a statement made
    // the customer's next "так" a confirmation of something they never chose.
    // `{reason}` is dropped: nothing ever wrote it — it always rendered the
    // same hardcoded «чудова якість та гарні відгуки».
    blocks: ['Раджу {product_name}. Ціна {price}\nОформлюємо його?'],
    requiredVariables: ['product_name', 'price'],
    toneTags: ['confident'],
    priority: 90,
    active: true,
  },
  {
    scenario: 'ask_recommendation_from_shown',
    stage: 'product_discovery',
    // Question form — see `recommend_product` above for why. Price sits on its
    // own segment so an unresolved `{price}` (which interpolates to '') can't
    // leave a dangling "— " mid-sentence.
    blocks: ['З цих раджу {product_name}. Ціна {price}\nОформлюємо його?'],
    requiredVariables: ['product_name'],
    toneTags: ['confident'],
    priority: 90,
    active: true,
  },
  {
    scenario: 'narrowing_no_match',
    stage: 'product_discovery',
    blocks: ['Серед показаних такого немає. Пошукати ширше в каталозі?'],
    requiredVariables: [],
    toneTags: ['confident'],
    priority: 90,
    active: true,
  },
  {
    scenario: 'product_not_found',
    stage: 'product_discovery',
    blocks: ['Зараз перевірю наявність і напишу вам.'],
    requiredVariables: [],
    toneTags: ['confident'],
    priority: 90,
    active: true,
  },
  {
    scenario: 'out_of_stock',
    stage: 'product_discovery',
    blocks: [
      'На жаль, {product_name} зараз немає в наявності. Можу підказати схожі моделі або повідомити, коли зʼявиться.',
    ],
    requiredVariables: ['product_name'],
    toneTags: ['confident'],
    priority: 90,
    active: true,
  },

  // ─── Variant selection ──────────────────────────────────────────
  {
    // Axis-neutral on purpose. The women's pack says «є в кольорах:
    // {variant_list}» and renders sizes into it on size-axis products —
    // a known copy bug. «Доступні варіанти» is correct either way.
    scenario: 'ask_variant_choice',
    stage: 'product_selection',
    blocks: ['{product_name} — доступні варіанти: {variant_list}. Що обираєте?'],
    requiredVariables: ['product_name', 'variant_list'],
    toneTags: ['confident'],
    priority: 90,
    active: true,
  },
  {
    scenario: 'ask_size_choice',
    stage: 'product_selected',
    blocks: ['{product_name} — розміри в наявності: {variant_list}\nЯкий ваш?'],
    requiredVariables: ['product_name', 'variant_list'],
    toneTags: ['confident'],
    priority: 90,
    active: true,
  },
  {
    scenario: 'ask_size_for_color',
    stage: 'product_selection',
    blocks: ['{product_name}, {color} — розміри: {variant_list}. Який потрібний?'],
    requiredVariables: ['product_name', 'color', 'variant_list'],
    toneTags: ['confident'],
    priority: 95,
    active: true,
  },
  {
    scenario: 'ask_color_for_size',
    stage: 'product_selection',
    blocks: ['{product_name} у розмірі {size} є в кольорах: {variant_list}. Який обираєте?'],
    requiredVariables: ['product_name', 'size', 'variant_list'],
    toneTags: ['confident'],
    priority: 95,
    active: true,
  },
  {
    scenario: 'variant_not_available',
    stage: '',
    blocks: ['На жаль, {requested_variant} немає в наявності.\nДоступні варіанти:\n{variant_list}'],
    requiredVariables: ['requested_variant', 'variant_list'],
    toneTags: ['confident'],
    priority: 95,
    active: true,
  },
  {
    scenario: 'confirm_variant_available',
    stage: 'product_selected',
    blocks: ['{product_name} — {price}\n{variant_name} є в наявності. Оформлюємо?'],
    requiredVariables: ['product_name', 'price', 'variant_name', 'variant_type'],
    toneTags: ['confident'],
    priority: 90,
    active: true,
  },
  {
    scenario: 'confirm_selection',
    stage: 'product_selection',
    blocks: ['{product_name} ({variant_name}), {price} — оформлюємо?'],
    requiredVariables: ['product_name', 'variant_name', 'price'],
    toneTags: ['confident'],
    priority: 90,
    active: true,
  },
  {
    scenario: 'confirm_selection_last_in_stock',
    stage: 'product_selected',
    blocks: ['{product_name} — {price}. {variant_name} — остання позиція в наявності.\nБеремо?'],
    requiredVariables: ['product_name', 'price', 'variant_name'],
    toneTags: ['confident'],
    priority: 95,
    active: true,
  },
  {
    scenario: 'confirm_color_variant_in_stock',
    stage: 'product_selected',
    blocks: [
      '{product_name} — {color_variant} є в наявності\n' +
        'Розміри: {sizes}\n' +
        'Також є в кольорах: {other_colors_variants}\n' +
        'Оформлюємо?',
    ],
    requiredVariables: ['product_name', 'color_variant', 'sizes', 'other_colors_variants'],
    toneTags: ['confident'],
    priority: 95,
    active: true,
  },

  // ─── Sizing help ────────────────────────────────────────────────
  {
    scenario: 'ask_pre_qualify',
    stage: 'pre_qualify',
    blocks: ['Підкажіть ваш зріст та вагу — підберу розмір 👌'],
    requiredVariables: [],
    toneTags: ['confident'],
    priority: 90,
    active: true,
  },
  {
    scenario: 'pre_qualify',
    stage: '',
    blocks: ['Підкажіть ваш зріст та вагу — підберу розмір 👌'],
    requiredVariables: [],
    toneTags: ['confident'],
    priority: 90,
    active: true,
  },
  {
    scenario: 'pre_qualify_with_price',
    stage: '',
    blocks: ['{product_name} — {price}. В наявності розміри: {variant_list}'],
    requiredVariables: ['product_name', 'price', 'variant_list'],
    toneTags: ['confident'],
    priority: 90,
    active: true,
  },
  {
    scenario: 'show_size_chart',
    stage: 'product_discovery',
    blocks: ['Ось розмірна сітка — {brand}, {name}'],
    requiredVariables: ['brand', 'name'],
    toneTags: ['confident'],
    priority: 90,
    active: true,
  },
  {
    // Prefix prepended to the reply after height/weight are collected.
    // Optional scenario — engine falls back to a hardcoded line carrying
    // 💛 when a tenant hasn't authored it, which is exactly why the
    // men's pack must.
    scenario: 'recommend_size',
    stage: 'pre_qualify',
    blocks: ['За вашими параметрами ваш розмір — {size} 👌'],
    requiredVariables: ['size'],
    toneTags: ['confident'],
    priority: 90,
    active: true,
  },

  // ─── Cart / checkout ────────────────────────────────────────────
  {
    scenario: 'ask_continue_or_checkout',
    stage: 'product_selection',
    blocks: ['{product_name} ({variant_name}) — додав до замовлення. Дивимось ще щось чи оформлюємо?'],
    requiredVariables: ['product_name'],
    toneTags: ['confident'],
    priority: 90,
    active: true,
  },
  {
    scenario: 'ask_cart_removal',
    stage: 'order_confirmation',
    blocks: ['Зараз у замовленні:\n{cart_list}\n\nЩо прибрати?'],
    requiredVariables: ['cart_list'],
    toneTags: ['confident'],
    priority: 90,
    active: true,
  },
  {
    scenario: 'collect_checkout_info',
    stage: 'checkout',
    blocks: ['Добре 🔥 Для оформлення напишіть:\n• ПІБ\n• Номер телефону\n• Місто та відділення Нової Пошти'],
    requiredVariables: [],
    toneTags: ['confident'],
    priority: 90,
    active: true,
  },
  {
    scenario: 'order_confirmed_ask_delivery',
    stage: 'checkout',
    blocks: ['Добре 🔥 Для оформлення напишіть:\n• ПІБ\n• Телефон\n• Місто та відділення НП'],
    requiredVariables: [],
    toneTags: ['confident'],
    priority: 90,
    active: true,
  },
  {
    scenario: 'confirm_order',
    stage: 'order_confirmation',
    blocks: ['Дякую. Ваше замовлення:\n{order_summary}\n\nОчікуйте повідомлення про відправку.'],
    requiredVariables: ['order_summary'],
    toneTags: ['confident'],
    priority: 90,
    active: true,
  },

  // ─── FAQ ────────────────────────────────────────────────────────
  {
    scenario: 'answer_delivery',
    stage: 'faq',
    blocks: ['Відправляємо Новою Поштою, зазвичай 1-3 дні після оформлення.'],
    requiredVariables: [],
    toneTags: ['confident'],
    priority: 90,
    active: true,
  },
  {
    scenario: 'answer_payment',
    stage: 'faq',
    blocks: ['Оплата при отриманні (накладений платіж) або передоплата на картку.'],
    requiredVariables: [],
    toneTags: ['confident'],
    priority: 90,
    active: true,
  },
];

// The whole point of this pack is that no 💛 reaches a men's-store demo.
// Fail at import time rather than at seed time — a heart pasted in from
// the women's pack is a copy bug, not a runtime condition.
for (const t of CLOTHING_MEN_TEMPLATES) {
  for (const block of t.blocks) {
    if (block.includes('💛')) {
      throw new Error(
        `CLOTHING_MEN_TEMPLATES: scenario "${t.scenario}" contains 💛 — ` +
          `the men's pack must not use it.`,
      );
    }
  }
}
