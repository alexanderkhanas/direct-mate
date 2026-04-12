import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import {
  CurrentUser,
  JwtPayload,
} from '../../common/decorators/current-user.decorator';
import { TestingService } from './testing.service';
import { SimulatorService } from './simulator.service';
import { SCENARIOS } from '../../scripts/scenarios';

@ApiTags('testing')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
@Controller('testing')
export class TestingController {
  constructor(
    private readonly testingService: TestingService,
    private readonly simulatorService: SimulatorService,
  ) {}

  // ─── Simulator endpoints ──────────────────────────────────────

  @Get('simulator/scenarios')
  getSimulatorScenarios() {
    return Object.entries(SCENARIOS).map(([key, s]) => ({
      key,
      name: s.name,
      tenantId: s.tenantId,
      turns: s.turns.length,
    }));
  }

  @Post('simulator/run')
  async runSimulatorScenario(@Body() body: { scenarioKey: string }) {
    const scenario = SCENARIOS[body.scenarioKey];
    if (!scenario) throw new NotFoundException(`Scenario "${body.scenarioKey}" not found`);
    const turns = await this.simulatorService.runScenario(scenario);
    return { scenario: body.scenarioKey, name: scenario.name, tenantId: scenario.tenantId, turns };
  }

  @Post('simulator/run-all')
  async runAllSimulatorScenarios() {
    const results = [];
    for (const [key, scenario] of Object.entries(SCENARIOS)) {
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
