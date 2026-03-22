import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StoreConfig } from './entities/store-config.entity';
import { ResponseTemplate } from './entities/response-template.entity';
import { PhraseBlock } from './entities/phrase-block.entity';
import { FaqItem } from './entities/faq-item.entity';
import { ClassifierService } from './classifier.service';
import { TemplateEngineService } from './template-engine.service';
import { PolicyEngineService } from './policy-engine.service';
import { StoreConfigController } from './store-config.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      StoreConfig,
      ResponseTemplate,
      PhraseBlock,
      FaqItem,
    ]),
  ],
  controllers: [StoreConfigController],
  providers: [ClassifierService, TemplateEngineService, PolicyEngineService],
  exports: [ClassifierService, TemplateEngineService, PolicyEngineService],
})
export class EngineModule {}
