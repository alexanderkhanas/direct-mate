import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { DataSource } from 'typeorm';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import {
  CurrentUser,
  JwtPayload,
} from '../../common/decorators/current-user.decorator';
import { TestingService } from './testing.service';
import { SimulatorService } from './simulator.service';
import { SCENARIOS, SimulatorScenario } from '../../scripts/scenarios';

/**
 * Returns scenarios visible to the caller:
 * - Superadmin without X-Tenant-Id header → all scenarios (all stores)
 * - Everyone else (including superadmin with tenant override) → scenarios
 *   whose `tenantId` matches the caller's tenant by either UUID or slug.
 *
 * Slug-aware so scenarios authored with `tenantId: 'luxe-space'` (or any
 * other slug constant — see `scripts/scenarios/types.ts`) match in both
 * dev and prod despite different per-env UUIDs. The user's JWT only
 * carries the UUID, so we look up the slug from the DB and accept either
 * identifier as a match.
 */
async function filterScenariosForRequest(
  req: Request & { user: JwtPayload },
  effectiveTenantId: string,
  dataSource: DataSource,
): Promise<Array<[string, SimulatorScenario]>> {
  const rawUser = req.user;
  const hasTenantOverride = Boolean(req.headers['x-tenant-id']);
  const isSuperadminGlobal = rawUser?.role === 'superadmin' && !hasTenantOverride;

  const entries = Object.entries(SCENARIOS);
  if (isSuperadminGlobal) return entries;

  const rows: Array<{ slug: string }> = await dataSource.query(
    `SELECT slug FROM tenants WHERE id = $1 LIMIT 1`,
    [effectiveTenantId],
  );
  const acceptableIds = new Set<string>([effectiveTenantId]);
  if (rows[0]?.slug) acceptableIds.add(rows[0].slug);
  return entries.filter(([, s]) => acceptableIds.has(s.tenantId));
}

@ApiTags('testing')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
@Controller('testing')
export class TestingController {
  constructor(
    private readonly testingService: TestingService,
    private readonly simulatorService: SimulatorService,
    private readonly dataSource: DataSource,
  ) {}

  // ─── Simulator endpoints ──────────────────────────────────────

  @Get('simulator/scenarios')
  async getSimulatorScenarios(
    @Req() req: Request & { user: JwtPayload },
    @CurrentUser() user: JwtPayload,
  ) {
    const visible = await filterScenariosForRequest(req, user.tenantId, this.dataSource);
    return visible.map(([key, s]) => ({
      key,
      name: s.name,
      tenantId: s.tenantId,
      turns: s.turns.length,
    }));
  }

  @Post('simulator/run')
  async runSimulatorScenario(
    @Body() body: { scenarioKey: string },
    @Req() req: Request & { user: JwtPayload },
    @CurrentUser() user: JwtPayload,
  ) {
    const visible = await filterScenariosForRequest(req, user.tenantId, this.dataSource);
    const entry = visible.find(([key]) => key === body.scenarioKey);
    if (!entry) throw new NotFoundException(`Scenario "${body.scenarioKey}" not found`);
    const [, scenario] = entry;
    const turns = await this.simulatorService.runScenario(scenario);
    return { scenario: body.scenarioKey, name: scenario.name, tenantId: scenario.tenantId, turns };
  }

  @Post('simulator/run-all')
  async runAllSimulatorScenarios(
    @Req() req: Request & { user: JwtPayload },
    @CurrentUser() user: JwtPayload,
  ) {
    const visible = await filterScenariosForRequest(req, user.tenantId, this.dataSource);
    const results = [];
    for (const [key, scenario] of visible) {
      const turns = await this.simulatorService.runScenario(scenario);
      results.push({ scenario: key, name: scenario.name, tenantId: scenario.tenantId, turns });
    }
    return results;
  }

  /**
   * Trigger a new test run. Returns the run ID immediately.
   * Tests execute asynchronously — poll GET /testing/runs/:id for status.
   */
  @Post('run')
  async startRun(@CurrentUser() user: JwtPayload) {
    const run = await this.testingService.startRun(user.tenantId, user.sub);
    return { id: run.id, status: run.status };
  }

  /**
   * List all test runs for the current tenant (newest first).
   */
  @Get('runs')
  async listRuns(@CurrentUser() user: JwtPayload) {
    return this.testingService.listRuns(user.tenantId);
  }

  /**
   * Get a single test run with all scenario results and steps.
   */
  @Get('runs/:id')
  async getRun(@Param('id') id: string) {
    const run = await this.testingService.getRunById(id);
    if (!run) throw new NotFoundException('Test run not found');
    return run;
  }

  /**
   * Update review status and comment on a scenario.
   */
  @Patch('runs/:runId/scenarios/:scenarioId')
  async updateScenarioReview(
    @Param('scenarioId') scenarioId: string,
    @Body() body: { reviewStatus: 'pending' | 'approved' | 'needs_fix'; reviewComment?: string },
  ) {
    const scenario = await this.testingService.updateScenarioReview(
      scenarioId,
      body.reviewStatus,
      body.reviewComment ?? null,
    );
    if (!scenario) throw new NotFoundException('Scenario not found');
    return scenario;
  }
}
