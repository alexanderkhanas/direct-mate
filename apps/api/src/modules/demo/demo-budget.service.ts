import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

// USD-cents per 1k tokens. Default OPENAI_MODEL=gpt-5.4-mini and
// OPENAI_FALLBACK_MODEL=gpt-5.4 per CLAUDE.md. Legacy gpt-4o entries
// kept as belt-and-braces for transient env misconfigurations.
const COST_RATES: Record<string, { input: number; output: number }> = {
  'gpt-5.4-mini': { input: 0.075, output: 0.450 },
  'gpt-5.4': { input: 0.250, output: 1.500 },
  'gpt-4o-mini': { input: 0.015, output: 0.060 },
  'gpt-4o': { input: 0.250, output: 1.000 },
};

@Injectable()
export class DemoBudgetService {
  private readonly logger = new Logger(DemoBudgetService.name);

  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Returns true iff today's USD-cents spend for `model` is under its cap.
   * Fail-closed for unknown models — refuses calls if no rate is configured,
   * preventing unbounded spend on a misconfigured model name.
   */
  async canSpend(model: string, capCents: number): Promise<boolean> {
    if (!COST_RATES[model]) {
      this.logger.warn(
        `Demo budget: unknown model '${model}' has no COST_RATES entry — refusing calls`,
      );
      return false;
    }
    const rows: Array<{ usd_cents: number }> = await this.dataSource.query(
      `SELECT usd_cents FROM demo_spend_daily WHERE day = CURRENT_DATE AND model = $1`,
      [model],
    );
    const spent = rows[0]?.usd_cents ?? 0;
    return spent < capCents;
  }

  /**
   * Atomically increment today's spend counter. Uses INSERT ... ON CONFLICT
   * so concurrent calls in the same process or across replicas serialize at
   * the row-lock level inside Postgres.
   */
  async chargeEstimate(
    model: string,
    inputTokens: number,
    outputTokens: number,
  ): Promise<void> {
    const rate = COST_RATES[model];
    if (!rate) {
      // Already logged in canSpend; nothing to charge against.
      return;
    }
    const cents = Math.ceil(
      (inputTokens * rate.input + outputTokens * rate.output) / 1000,
    );
    await this.dataSource.query(
      `INSERT INTO demo_spend_daily (day, model, usd_cents, calls)
       VALUES (CURRENT_DATE, $1, $2, 1)
       ON CONFLICT (day, model) DO UPDATE
         SET usd_cents = demo_spend_daily.usd_cents + EXCLUDED.usd_cents,
             calls = demo_spend_daily.calls + 1`,
      [model, cents],
    );
  }
}
