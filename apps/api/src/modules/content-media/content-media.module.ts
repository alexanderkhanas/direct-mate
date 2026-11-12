import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { InstagramContentModule } from '../channels/instagram/instagram-content.module';
import { CustomerMediaModule } from '../customer-media/customer-media.module';
import { ContentMediaService } from './content-media.service';

@Module({
  imports: [InstagramContentModule, CustomerMediaModule, CatalogModule],
  providers: [ContentMediaService],
  exports: [ContentMediaService],
})
export class ContentMediaModule {}
