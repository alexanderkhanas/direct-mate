import { Scenario } from '../types';
import { CLOTHING_SCENARIOS } from './clothing-scenarios';
import { COSMETICS_SCENARIOS } from './cosmetics-scenarios';

export type DemoTenantSlug = 'demo-women-clothes' | 'demo-cosmetics';

/**
 * Returns the scenario set for a demo tenant slug. Both sets ship in the same
 * lazy DemoWidget chunk (per Phase 0 Q3 decision: shared bundle, switch at
 * runtime) — no per-tab code splitting.
 */
export function getScenariosForTenant(slug: DemoTenantSlug): Scenario[] {
  if (slug === 'demo-cosmetics') return COSMETICS_SCENARIOS;
  return CLOTHING_SCENARIOS;
}

export { CLOTHING_SCENARIOS, COSMETICS_SCENARIOS };
