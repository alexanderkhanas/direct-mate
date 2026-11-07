import { Module } from '@nestjs/common';
import { ConversationsModule } from '../conversations/conversations.module';
import { CustomerMediaModule } from '../customer-media/customer-media.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { TestingModule } from '../testing/testing.module';
import { OnboardingController } from './onboarding.controller';
import { OnboardingReadiness } from './onboarding-readiness.service';
import { OnboardingService } from './onboarding.service';
import { TestChatService } from './test-chat.service';

@Module({
  imports: [ConversationsModule, CustomerMediaModule, NotificationsModule, TestingModule],
  controllers: [OnboardingController],
  providers: [OnboardingReadiness, OnboardingService, TestChatService],
  exports: [OnboardingReadiness, OnboardingService],
})
export class OnboardingModule {}
