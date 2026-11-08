import { Module } from '@nestjs/common';
import { ConversationsModule } from '../conversations/conversations.module';
import { CustomerMediaModule } from '../customer-media/customer-media.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { TestingModule } from '../testing/testing.module';
import { AgentModule } from '../agent/agent.module';
import { CryptoService } from '../../common/crypto.service';
import { GraphHistoryClient } from './history/graph-history.client';
import { HistoryImportService } from './history/history-import.service';
import { NotesDrafterService } from './notes-drafter.service';
import { OnboardingController } from './onboarding.controller';
import { OnboardingReadiness } from './onboarding-readiness.service';
import { OnboardingService } from './onboarding.service';
import { TestChatService } from './test-chat.service';

@Module({
  imports: [ConversationsModule, CustomerMediaModule, NotificationsModule, TestingModule, AgentModule],
  controllers: [OnboardingController],
  providers: [
    OnboardingReadiness,
    OnboardingService,
    TestChatService,
    NotesDrafterService,
    CryptoService,
    GraphHistoryClient,
    HistoryImportService,
  ],
  exports: [OnboardingReadiness, OnboardingService],
})
export class OnboardingModule {}
