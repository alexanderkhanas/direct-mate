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

@ApiTags('testing')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
@Controller('testing')
export class TestingController {
  constructor(private readonly testingService: TestingService) {}

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
