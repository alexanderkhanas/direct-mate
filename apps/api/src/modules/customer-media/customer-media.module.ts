import { Module } from '@nestjs/common';
import { CustomerMediaService } from './customer-media.service';

@Module({
  providers: [CustomerMediaService],
  exports: [CustomerMediaService],
})
export class CustomerMediaModule {}
