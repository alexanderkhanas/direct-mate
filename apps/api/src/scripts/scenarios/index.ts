// ─── Simulator Scenario Registry ─────────────────────────────────
//
// Scenarios are split into per-tenant directories. Each tenant module
// exports its own scenario map; this index flattens them into a single
// registry keyed by scenario name (keys must be globally unique).

import { SimulatorScenario } from './types';
import { PILOT_STORE_SCENARIOS } from './pilot-store';
import { CLOTHES_STORE_SCENARIOS } from './clothes-store';

export { SimulatorScenario, SimulatorTurn, SimulatorTurnExpect, PILOT_STORE, CLOTHES_STORE } from './types';

export const SCENARIOS: Record<string, SimulatorScenario> = {
  ...PILOT_STORE_SCENARIOS,
  ...CLOTHES_STORE_SCENARIOS,
};
