import { Module } from '@nestjs/common';
import { TestingController } from './testing.controller';
import { SimulatorService } from './simulator.service';
import { ConversationsModule } from '../conversations/conversations.module';
import { OrdersModule } from '../orders/orders.module';
import { AgentModule } from '../agent/agent.module';
import { CustomerMediaModule } from '../customer-media/customer-media.module';
import { ScenarioRunner } from './scenario-runner.service';

@Module({
  imports: [
    ConversationsModule,
    OrdersModule,
    AgentModule,
    CustomerMediaModule,
  ],
  controllers: [TestingController],
  providers: [SimulatorService, ScenarioRunner],
  exports: [ScenarioRunner],
})
export class TestingModule {}
