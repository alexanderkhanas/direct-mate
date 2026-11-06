import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TestRun } from './entities/test-run.entity';
import { TestRunScenario } from './entities/test-run-scenario.entity';
import { TestingController } from './testing.controller';
import { TestingService } from './testing.service';
import { SimulatorService } from './simulator.service';
import { ConversationsModule } from '../conversations/conversations.module';
import { OrdersModule } from '../orders/orders.module';
import { AgentModule } from '../agent/agent.module';
import { CustomerMediaModule } from '../customer-media/customer-media.module';
import { ScenarioRunner } from './scenario-runner.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([TestRun, TestRunScenario]),
    ConversationsModule,
    OrdersModule,
    AgentModule,
    CustomerMediaModule,
  ],
  controllers: [TestingController],
  providers: [TestingService, SimulatorService, ScenarioRunner],
  exports: [ScenarioRunner],
})
export class TestingModule {}
