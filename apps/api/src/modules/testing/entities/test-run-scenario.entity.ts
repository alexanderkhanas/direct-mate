import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { TestRun } from './test-run.entity';

@Entity('test_run_scenarios')
export class TestRunScenario {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  runId!: string;

  @Column({ type: 'text' })
  scenarioName!: string;

  @Column({ type: 'text' })
  scenarioFile!: string;

  @Column({ type: 'text', default: 'pending' })
  status!: 'pending' | 'running' | 'passed' | 'failed';

  @Column({ type: 'text', default: 'pending' })
  reviewStatus!: 'pending' | 'approved' | 'needs_fix';

  @Column({ type: 'text', nullable: true })
  reviewComment!: string | null;

  @Column({ type: 'jsonb', default: '[]' })
  steps!: Record<string, unknown>[];

  @Column({ type: 'int', nullable: true })
  durationMs!: number | null;

  @Column({ type: 'text', nullable: true })
  errorMessage!: string | null;

  @ManyToOne(() => TestRun, (r) => r.scenarios, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'run_id' })
  run!: TestRun;
}
