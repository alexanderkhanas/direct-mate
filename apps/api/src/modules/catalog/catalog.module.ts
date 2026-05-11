import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Product } from './entities/product.entity';
import { ProductVariant } from './entities/product-variant.entity';
import { StockBalance } from './entities/stock-balance.entity';
import { ProductMedia } from './entities/product-media.entity';
import { Category } from './entities/category.entity';
import { CatalogService } from './catalog.service';
import { CatalogController } from './catalog.controller';
import { ImageHashService } from './image-hash.service';
import { ImageEmbeddingService } from './image-embedding.service';
import { ProductMediaEmbedderService } from './product-media-embedder.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Product,
      ProductVariant,
      StockBalance,
      ProductMedia,
      Category,
    ]),
  ],
  controllers: [CatalogController],
  providers: [
    CatalogService,
    ImageHashService,
    ImageEmbeddingService,
    ProductMediaEmbedderService,
  ],
  exports: [
    CatalogService,
    ImageHashService,
    ImageEmbeddingService,
    TypeOrmModule,
  ],
})
export class CatalogModule {}
