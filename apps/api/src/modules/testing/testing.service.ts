import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ModuleRef } from '@nestjs/core';
import { Repository } from 'typeorm';
import * as fs from 'fs';
import * as path from 'path';
import { TestRun } from './entities/test-run.entity';
import { TestRunScenario } from './entities/test-run-scenario.entity';
import {
  ConversationTestRunner,
  TestScenario,
} from '../../testing/conversation-test-runner';

// js-yaml is available from root node_modules
// eslint-disable-next-line @typescript-eslint/no-var-requires
const yaml = require('js-yaml');

@Injectable()
export class TestingService {
  private readonly logger = new Logger(TestingService.name);

  constructor(
    @InjectRepository(TestRun)
    private readonly runRepo: Repository<TestRun>,
    @InjectRepository(TestRunScenario)
    private readonly scenarioRepo: Repository<TestRunScenario>,
    private readonly moduleRef: ModuleRef,
  ) {}

  /**
   * List all test runs for a tenant, newest first.
   */
  async listRuns(tenantId: string): Promise<TestRun[]> {
    return this.runRepo.find({
      where: { tenantId },
      order: { startedAt: 'DESC' },
    });
  }

  /**
   * Get a single test run with all scenario results.
   */
  async getRunById(runId: string): Promise<TestRun | null> {
    return this.runRepo.findOne({
      where: { id: runId },
      relations: ['scenarios'],
    });
  }

  /**
   * Update review status and comment on a scenario.
   */
  async updateScenarioReview(
    scenarioId: string,
    reviewStatus: 'pending' | 'approved' | 'needs_fix',
    reviewComment: string | null,
  ): Promise<TestRunScenario | null> {
    await this.scenarioRepo.update(scenarioId, {
      reviewStatus,
      reviewComment,
    } as any);
    return this.scenarioRepo.findOneBy({ id: scenarioId });
  }

  /**
   * Create a new test run and execute all scenarios asynchronously.
   * Returns the run record immediately.
   */
  async startRun(tenantId: string, userId: string): Promise<TestRun> {
    // Load scenario files
    const scenarios = this.loadScenarioFiles();
    this.logger.log(`Loaded ${scenarios.length} scenarios for test run`);

    // Create run record
    const run = this.runRepo.create({
      tenantId,
      status: 'running',
      totalScenarios: scenarios.length,
      createdByUserId: userId,
    });
    const saved = await this.runRepo.save(run);

    // Create pending scenario records
    for (const { scenario, fileName } of scenarios) {
      const scenarioRecord = this.scenarioRepo.create({
        runId: saved.id,
        scenarioName: scenario.name,
        scenarioFile: fileName,
        status: 'pending',
      });
      await this.scenarioRepo.save(scenarioRecord);
    }

    // Run tests asynchronously — don't await
    this.executeRun(saved.id, scenarios).catch(async (err) => {
      this.logger.error(`Test run ${saved.id} failed fatally: ${err.message}`, err.stack);
      try {
        await this.runRepo.update(saved.id, {
          status: 'failed',
          completedAt: new Date(),
        } as any);
      } catch {
        // best-effort update
      }
    });

    return saved;
  }

  /**
   * Load all YAML scenario files from the scenarios directory.
   */
  private loadScenarioFiles(): Array<{ scenario: TestScenario; fileName: string }> {
    // Try multiple paths since cwd may vary (monorepo root vs apps/api/)
    const candidates = [
      path.join(process.cwd(), 'src', 'testing', 'scenarios'),
      path.join(process.cwd(), 'apps', 'api', 'src', 'testing', 'scenarios'),
      path.join(__dirname, '..', '..', '..', 'testing', 'scenarios'),
    ];
    const scenariosDir = candidates.find((d) => fs.existsSync(d)) ?? candidates[0];

    if (!fs.existsSync(scenariosDir)) {
      this.logger.warn(`Scenarios directory not found: ${scenariosDir}`);
      return [];
    }

    const files = fs
      .readdirSync(scenariosDir)
      .filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'))
      .sort();

    return files.map((fileName) => {
      const filePath = path.join(scenariosDir, fileName);
      const content = fs.readFileSync(filePath, 'utf-8');
      const scenario = yaml.load(content) as TestScenario;
      return { scenario, fileName };
    });
  }

  /**
   * Execute all scenarios for a test run.
   * Updates DB records as each scenario completes.
   */
  private async executeRun(
    runId: string,
    scenarios: Array<{ scenario: TestScenario; fileName: string }>,
  ): Promise<void> {
    // Create a wrapper that delegates .get() to ModuleRef with strict:false (global resolution)
    const appProxy = {
      get: (token: any) => this.moduleRef.get(token, { strict: false }),
    } as import('@nestjs/common').INestApplicationContext;
    const runner = new ConversationTestRunner(appProxy, false);

    let passed = 0;
    let failed = 0;

    // Load scenario records for this run
    const scenarioRecords = await this.scenarioRepo.find({
      where: { runId },
      order: { scenarioFile: 'ASC' },
    });

    for (let i = 0; i < scenarios.length; i++) {
      const { scenario, fileName } = scenarios[i];
      const record = scenarioRecords.find((r) => r.scenarioFile === fileName);
      if (!record) continue;

      // Mark as running
      await this.scenarioRepo.update(record.id, { status: 'running' } as any);

      try {
        this.logger.log(`Running scenario [${i + 1}/${scenarios.length}]: ${scenario.name}`);
        const result = await runner.runScenarioStructured(scenario, fileName);

        // Save step results
        await this.scenarioRepo.update(record.id, {
          status: result.passed ? 'passed' : 'failed',
          steps: result.steps as any,
          durationMs: result.totalDuration,
          errorMessage: result.error ?? null,
        } as any);

        if (result.passed) {
          passed++;
        } else {
          failed++;
        }
      } catch (err) {
        await this.scenarioRepo.update(record.id, {
          status: 'failed',
          errorMessage: `Execution error: ${(err as Error).message}`,
        } as any);
        failed++;
      }
    }

    // Update run totals
    await this.runRepo.update(runId, {
      status: 'completed',
      passedScenarios: passed,
      failedScenarios: failed,
      completedAt: new Date(),
    } as any);

    this.logger.log(
      `Test run ${runId} completed: ${passed}/${scenarios.length} passed, ${failed} failed`,
    );
  }
}
