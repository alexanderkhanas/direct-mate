// ─── Simulator Scenario Registry ─────────────────────────────────
//
// Scenarios are split into per-tenant directories. Each tenant module
// exports its own scenario map; this index flattens them into a single
// registry keyed by scenario name (keys must be globally unique).

import { SimulatorScenario } from './types';
import { PILOT_STORE_SCENARIOS } from './pilot-store';
import { CLOTHES_STORE_SCENARIOS } from './clothes-store';
import { COSMETICS_SCENARIOS } from './cosmetics';
import { LUXESPACE_SCENARIOS } from './luxespace';

export {
  SimulatorScenario,
  SimulatorTurn,
  SimulatorTurnExpect,
  PILOT_STORE,
  CLOTHES_STORE,
  LUXESPACE,
  DEMO_WOMEN_CLOTHES_SLUG,
  DEMO_COSMETICS_SLUG,
} from './types';

export const SCENARIOS: Record<string, SimulatorScenario> = {
  ...PILOT_STORE_SCENARIOS,
  ...CLOTHES_STORE_SCENARIOS,
  ...COSMETICS_SCENARIOS,
  ...LUXESPACE_SCENARIOS,
};
