// Single source of truth for demo-tenant templates.
// Seed scripts call getTemplatesForBusinessType(...) and INSERT each spec
// into the response_templates table.

import { TemplateSpec } from './types';
import { BASE_TEMPLATES } from './base';
import { CLOTHING_TEMPLATES } from './clothing';
import { CLOTHING_MEN_TEMPLATES } from './clothing-men';
import { COSMETICS_TEMPLATES } from './cosmetics';

/**
 * Template pack key. NOT the same thing as `flow_config.businessType`,
 * which drives engine routing and only knows 'clothing' | 'cosmetics' —
 * `clothing-men` is a copy variant of the clothing vertical, so a men's
 * tenant seeds these templates while still setting businessType='clothing'.
 */
export type DemoBusinessType = 'clothing' | 'clothing-men' | 'cosmetics';

const PACKS: Record<DemoBusinessType, TemplateSpec[]> = {
  clothing: CLOTHING_TEMPLATES,
  // Full pack, deliberately NOT layered over CLOTHING_TEMPLATES: partial
  // override would let 💛 back in through any scenario added to the
  // women's pack later. See clothing-men/index.ts.
  'clothing-men': CLOTHING_MEN_TEMPLATES,
  cosmetics: COSMETICS_TEMPLATES,
};

/**
 * Merge base + vertical templates. Vertical wins on scenario collision.
 * Used by per-vertical seed builders.
 */
export function getTemplatesForBusinessType(
  businessType: DemoBusinessType,
): TemplateSpec[] {
  const vertical = PACKS[businessType];
  const merged = new Map<string, TemplateSpec>();
  for (const t of BASE_TEMPLATES) merged.set(t.scenario, t);
  for (const t of vertical) merged.set(t.scenario, t);
  const result = Array.from(merged.values());

  // The men's pack overrides every BASE scenario precisely so no 💛
  // survives the merge. Assert it here rather than trusting that
  // coverage stays complete: a scenario added to BASE_TEMPLATES later
  // would otherwise fall through to a men's tenant carrying the heart.
  if (businessType === 'clothing-men') {
    const leaked = result.filter((t) => t.blocks.some((b) => b.includes('💛')));
    if (leaked.length > 0) {
      throw new Error(
        `clothing-men pack: ${leaked.map((t) => t.scenario).join(', ')} ` +
          `fell through to BASE_TEMPLATES and still contain 💛 — ` +
          `add an override in seed/templates/clothing-men/index.ts.`,
      );
    }
  }

  return result;
}

export {
  BASE_TEMPLATES,
  CLOTHING_TEMPLATES,
  CLOTHING_MEN_TEMPLATES,
  COSMETICS_TEMPLATES,
};
export type { TemplateSpec, PhraseBlockSpec, FaqItemSpec } from './types';
