import { Module } from '@nestjs/common';
import { CustomerMediaService } from './customer-media.service';
import { VoiceMessagesService } from './voice-messages.service';

@Module({
  providers: [CustomerMediaService, VoiceMessagesService],
  exports: [CustomerMediaService, VoiceMessagesService],
})
export class CustomerMediaModule {}
