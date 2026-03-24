import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { TestRunScenario } from './test-run-scenario.entity';

@Entity('test_runs')
export class TestRun {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  tenantId!: string;

  @Column({ type: 'text', default: 'running' })
  status!: 'running' | 'completed' | 'failed';

  @Column({ type: 'int', default: 0 })
  totalScenarios!: number;

  @Column({ type: 'int', default: 0 })
  passedScenarios!: number;

  @Column({ type: 'int', default: 0 })
  failedScenarios!: number;

  @Column({ type: 'timestamptz', default: () => 'now()' })
  startedAt!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  completedAt!: Date | null;

  @Column({ type: 'uuid', nullable: true })
  createdByUserId!: string | null;

  @OneToMany(() => TestRunScenario, (s) => s.run, { cascade: true })
  scenarios!: TestRunScenario[];
}
