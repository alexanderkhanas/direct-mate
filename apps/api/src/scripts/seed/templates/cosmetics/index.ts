// Cosmetics-vertical templates. Used by demo-cosmetics. Content references
// skin type pre-qualify and skincare-product concepts — no height/weight,
// no size charts.

import { TemplateSpec } from '../types';

export const COSMETICS_TEMPLATES: TemplateSpec[] = [
  {
    scenario: 'ask_pre_qualify',
    stage: 'pre_qualify',
    blocks: ['Який у вас тип шкіри? (жирна / суха / нормальна / комбінована / чутлива) 💛'],
    requiredVariables: [],
    toneTags: ['warm'],
    priority: 90,
    active: true,
  },
  {
    scenario: 'show_products',
    stage: 'product_discovery',
    blocks: ['Ось що є в наявності 💛\n\n{product_list}'],
    requiredVariables: ['product_list'],
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
    // Price + variant offer in one bubble. See the clothing sibling.
    scenario: 'show_price_with_variants',
    stage: 'product_discovery',
    blocks: [
      'Ціна на {product_name} — {price} 💛\nВ наявності: {variant_list}\nЩо вам цікаво?',
    ],
    requiredVariables: ['product_name', 'price', 'variant_list'],
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
    blocks: ['Раджу {product_name}. Підходить для {skin_type} шкіри. Ціна {price} 💛\nОформлюємо його?'],
    requiredVariables: ['product_name', 'price'],
    toneTags: ['warm'],
    priority: 90,
    active: true,
  },
  {
    // Cosmetics had NO template for this scenario: the router picked it,
    // `renderScenario` returned null, and the turn fell into AI fallback.
    // Deliberately does not mention skin type — this fires when the customer
    // asks "which of these?" about an already-shown list, where the skin-type
    // framing has usually been said once already.
    scenario: 'ask_recommendation_from_shown',
    stage: 'product_discovery',
    blocks: ['З цих раджу {product_name}. Ціна {price} 💛\nОформлюємо його?'],
    requiredVariables: ['product_name'],
    toneTags: ['warm'],
    priority: 90,
    active: true,
  },
  {
    scenario: 'ask_variant_choice',
    stage: 'product_selection',
    blocks: ['У {product_name} є такі варіанти:\n{variant_list}\nЯкий вам цікавий? 💛'],
    requiredVariables: ['product_name', 'variant_list'],
    toneTags: ['warm'],
    priority: 90,
    active: true,
  },
  {
    scenario: 'out_of_stock',
    stage: 'product_discovery',
    blocks: ["На жаль, {product_name} зараз немає в наявності. Можу підказати схожі варіанти 💛"],
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
    scenario: 'cosmetics_safety_handoff',
    stage: 'handoff_to_manager',
    blocks: ['Дайте хвилинку — зараз уточню для вас 💛'],
    requiredVariables: [],
    toneTags: ['warm'],
    priority: 95,
    active: true,
  },
];
