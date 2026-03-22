import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScreenshotImportJob } from './entities/screenshot-import-job.entity';
import { ScreenshotImportFile } from './entities/screenshot-import-file.entity';
import { ExtractedConversationFragment } from './entities/extracted-conversation-fragment.entity';
import { ExtractedPhrase } from './entities/extracted-phrase.entity';
import { ExtractedVoiceSignal } from './entities/extracted-voice-signal.entity';
import { ManagerExample } from '../settings/entities/manager-example.entity';
import { ScreenshotUploadController } from './screenshot-upload.controller';
import { ScreenshotReviewController } from './screenshot-review.controller';
import { ScreenshotExtractionService } from './screenshot-extraction.service';
import { ScreenshotApprovalService } from './screenshot-approval.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ScreenshotImportJob,
      ScreenshotImportFile,
      ExtractedConversationFragment,
      ExtractedPhrase,
      ExtractedVoiceSignal,
      ManagerExample,
    ]),
  ],
  controllers: [ScreenshotUploadController, ScreenshotReviewController],
  providers: [ScreenshotExtractionService, ScreenshotApprovalService],
  exports: [ScreenshotExtractionService, ScreenshotApprovalService],
})
export class ScreenshotTrainingModule {}
