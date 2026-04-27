// Single source of truth for demo-tenant templates.
// Seed scripts call getTemplatesForBusinessType(...) and INSERT each spec
// into the response_templates table.

import { TemplateSpec } from './types';
import { BASE_TEMPLATES } from './base';
import { CLOTHING_TEMPLATES } from './clothing';
import { COSMETICS_TEMPLATES } from './cosmetics';

export type DemoBusinessType = 'clothing' | 'cosmetics';

/**
 * Merge base + vertical templates. Vertical wins on scenario collision.
 * Used by per-vertical seed builders.
 */
export function getTemplatesForBusinessType(
  businessType: DemoBusinessType,
): TemplateSpec[] {
  const vertical =
    businessType === 'clothing' ? CLOTHING_TEMPLATES : COSMETICS_TEMPLATES;
  const merged = new Map<string, TemplateSpec>();
  for (const t of BASE_TEMPLATES) merged.set(t.scenario, t);
  for (const t of vertical) merged.set(t.scenario, t);
  return Array.from(merged.values());
}

export { BASE_TEMPLATES, CLOTHING_TEMPLATES, COSMETICS_TEMPLATES };
export type { TemplateSpec, PhraseBlockSpec, FaqItemSpec } from './types';
