import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InstagramMediaMapping } from './entities/instagram-media-mapping.entity';
import { Connection } from '../../integrations/entities/connection.entity';
import { Product } from '../../catalog/entities/product.entity';
import { ProductVariant } from '../../catalog/entities/product-variant.entity';
import { StoreConfig } from '../../engine/entities/store-config.entity';
import { InstagramContentService } from './instagram-content.service';
import { ContentLinksService } from './content-links.service';
import { InstagramContentController, InternalInstagramContentController } from './instagram-content.controller';
import { CryptoService } from '../../../common/crypto.service';
import { IntegrationsModule } from '../../integrations/integrations.module';
import { CatalogModule } from '../../catalog/catalog.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([InstagramMediaMapping, Connection, Product, ProductVariant, StoreConfig]),
    IntegrationsModule,
    CatalogModule,
  ],
  controllers: [InstagramContentController, InternalInstagramContentController],
  providers: [InstagramContentService, ContentLinksService, CryptoService],
  exports: [InstagramContentService, ContentLinksService],
})
export class InstagramContentModule {}
