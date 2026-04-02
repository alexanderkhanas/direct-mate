import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScreenshotImportJob } from './entities/screenshot-import-job.entity';
import { ScreenshotImportFile } from './entities/screenshot-import-file.entity';
import { ExtractedConversationFragment } from './entities/extracted-conversation-fragment.entity';
import { ExtractedPhrase } from './entities/extracted-phrase.entity';
import { ExtractedVoiceSignal } from './entities/extracted-voice-signal.entity';
import { ManagerExample } from '../settings/entities/manager-example.entity';
import { StoreConfig } from '../engine/entities/store-config.entity';
import { ScreenshotUploadController } from './screenshot-upload.controller';
import { ScreenshotReviewController } from './screenshot-review.controller';
import { ScreenshotExtractionService } from './screenshot-extraction.service';
import { ScreenshotApprovalService } from './screenshot-approval.service';
import { LearningObserverService } from './learning-observer.service';
import { LearningSchedulerService } from './learning-scheduler.service';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ScreenshotImportJob,
      ScreenshotImportFile,
      ExtractedConversationFragment,
      ExtractedPhrase,
      ExtractedVoiceSignal,
      ManagerExample,
      StoreConfig,
    ]),
    NotificationsModule,
  ],
  controllers: [ScreenshotUploadController, ScreenshotReviewController],
  providers: [
    ScreenshotExtractionService,
    ScreenshotApprovalService,
    LearningObserverService,
    LearningSchedulerService,
  ],
  exports: [ScreenshotExtractionService, ScreenshotApprovalService, LearningObserverService],
})
export class ScreenshotTrainingModule {}
