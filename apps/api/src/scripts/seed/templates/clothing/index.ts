// Clothing-vertical templates. Used by demo-women-clothes (and any future
// clothing demo tenant). Content references height/weight pre-qualify and
// size-chart concepts — must NOT be reused for cosmetics.

import { TemplateSpec } from '../types';

export const CLOTHING_TEMPLATES: TemplateSpec[] = [
  {
    scenario: 'ask_pre_qualify',
    stage: 'pre_qualify',
    blocks: ['Підкажіть ваш зріст та вагу, щоб підібрати розмір 💛'],
    requiredVariables: [],
    toneTags: ['warm'],
    priority: 90,
    active: true,
  },
  {
    scenario: 'pre_qualify',
    stage: '',
    blocks: ['Підкажіть ваш зріст та вагу, щоб підібрати розмір 💛'],
    requiredVariables: [],
    toneTags: ['warm'],
    priority: 90,
    active: true,
  },
  {
    scenario: 'pre_qualify_with_price',
    stage: '',
    blocks: ['Ціна {product_name} — {price}, в наявності розміри: {variant_list} 💛'],
    requiredVariables: ['product_name', 'price', 'variant_list'],
    toneTags: ['warm'],
    priority: 90,
    active: true,
  },
  {
    scenario: 'ask_size_choice',
    stage: 'product_selected',
    blocks: ['У {product_name} є такі розміри: {variant_list}\nЯкий розмір вам підходить? 💛'],
    requiredVariables: ['product_name', 'variant_list'],
    toneTags: ['warm'],
    priority: 90,
    active: true,
  },
  {
    scenario: 'ask_variant_choice',
    stage: 'product_selection',
    blocks: ['{product_name} є в кольорах: {variant_list}. Який обираєте? 💛'],
    requiredVariables: ['product_name', 'variant_list'],
    toneTags: ['warm'],
    priority: 90,
    active: true,
  },
  {
    scenario: 'ask_size_for_color',
    stage: 'product_selection',
    blocks: ['{product_name} — {color}, розміри: {variant_list}. Який потрібний? 💛'],
    requiredVariables: ['product_name', 'color', 'variant_list'],
    toneTags: ['warm'],
    priority: 95,
    active: true,
  },
  {
    scenario: 'ask_color_for_size',
    stage: 'product_selection',
    blocks: ['{product_name} розміру {size} є у кольорах: {variant_list}. Який обираєте? 💛'],
    requiredVariables: ['product_name', 'size', 'variant_list'],
    toneTags: ['warm'],
    priority: 95,
    active: true,
  },
  {
    scenario: 'show_size_chart',
    stage: 'product_discovery',
    blocks: ['Ось розмірна сітка для {brand} — {name} 💛'],
    requiredVariables: ['brand', 'name'],
    toneTags: ['warm'],
    priority: 90,
    active: true,
  },
  {
    scenario: 'show_price',
    stage: 'product_discovery',
    blocks: ['Ціна на {product_name} — {price} 💛'],
    requiredVariables: ['product_name', 'price'],
    toneTags: ['warm'],
    priority: 90,
    active: true,
  },
  {
    // Price + variant offer in one bubble. Rendered instead of
    // `show_price` when the priced product has >1 variant in stock and
    // the customer hasn't named one.
    //
    // Deliberately no {variant_type}: for a two-axis product the list
    // renders grouped ("Cream: S, M, L") while detectVariantType reports
    // a single axis ("Розміри"), producing "Розміри в наявності: Cream:
    // S, M, L". An axis-free lead-in stays correct for one-axis and
    // two-axis catalogs alike. Same reason the clothing
    // `ask_variant_choice` copy ("є в кольорах: …") is a known bug.
    scenario: 'show_price_with_variants',
    stage: 'product_discovery',
    blocks: [
      'Ціна на {product_name} — {price} 💛\nВ наявності: {variant_list}\nЩо вам підходить?',
    ],
    requiredVariables: ['product_name', 'price', 'variant_list'],
    toneTags: ['warm'],
    priority: 90,
    active: true,
  },
  {
    scenario: 'show_products',
    stage: 'product_discovery',
    blocks: ['В наявності є такі варіанти 💛\n\n{product_list}'],
    requiredVariables: ['product_list'],
    toneTags: ['warm'],
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
    blocks: ['Ось що є в наявності для розміру {size} 💛\n\n{product_list}'],
    requiredVariables: ['size', 'product_list'],
    toneTags: ['warm'],
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
    blocks: ['Раджу {product_name}. Ціна {price} 💛\nОформлюємо його?'],
    requiredVariables: ['product_name', 'price'],
    toneTags: ['warm'],
    priority: 90,
    active: true,
  },
  {
    scenario: 'out_of_stock',
    stage: 'product_discovery',
    blocks: ["На жаль, {product_name} зараз немає в наявності. Можу підказати схожі варіанти або повідомити, коли з'явиться 💛"],
    requiredVariables: ['product_name'],
    toneTags: ['warm'],
    priority: 90,
    active: true,
  },
  {
    scenario: 'variant_not_available',
    stage: '',
    blocks: ['На жаль, {requested_variant} немає в наявності.\nДоступні варіанти:\n{variant_list} 💛'],
    requiredVariables: ['requested_variant', 'variant_list'],
    toneTags: ['warm'],
    priority: 95,
    active: true,
  },
  {
    scenario: 'ask_recommendation_from_shown',
    stage: 'product_discovery',
    // Question form — see `recommend_product` above for why. Price sits on its
    // own segment so an unresolved `{price}` (which interpolates to '') can't
    // leave a dangling "— " mid-sentence.
    blocks: ['З цих раджу {product_name}. Ціна {price} 💛\nОформлюємо його?'],
    requiredVariables: ['product_name'],
    toneTags: ['warm'],
    priority: 90,
    active: true,
  },
];
