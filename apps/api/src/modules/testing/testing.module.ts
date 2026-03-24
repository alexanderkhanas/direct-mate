import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TestRun } from './entities/test-run.entity';
import { TestRunScenario } from './entities/test-run-scenario.entity';
import { TestingController } from './testing.controller';
import { TestingService } from './testing.service';
import { ConversationsModule } from '../conversations/conversations.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([TestRun, TestRunScenario]),
    ConversationsModule,
  ],
  controllers: [TestingController],
  providers: [TestingService],
})
export class TestingModule {}
