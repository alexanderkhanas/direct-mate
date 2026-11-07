/**
 * Managers' working hours, per day: `mon`…`sun` (or `mon_fri` for a range,
 * as the seeds write it) → `'09:00-18:00'` or `'closed'`. Kyiv time.
 */
export type BusinessHours = Record<string, string>;

export interface HandoffRules {
  maxFailedTurns: number;
  stockFreshnessMinutes: number;
  negativeSentimentEscalation: boolean;
}
