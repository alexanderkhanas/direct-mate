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
    scenario: 'recommend_product',
    stage: 'product_discovery',
    blocks: ['{product_name} — {reason}. Ціна {price} 💛'],
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
    blocks: ['З цих варіантів раджу {product_name} — {reason} 💛'],
    requiredVariables: ['product_name'],
    toneTags: ['warm'],
    priority: 90,
    active: true,
  },
];
