import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import {
  CurrentUser,
  JwtPayload,
} from '../../common/decorators/current-user.decorator';
import { StoreConfig } from './entities/store-config.entity';
import { ResponseTemplate } from './entities/response-template.entity';
import { PhraseBlock } from './entities/phrase-block.entity';
import { FaqItem } from './entities/faq-item.entity';

@ApiTags('engine')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
@Controller('engine')
export class StoreConfigController {
  constructor(
    @InjectRepository(StoreConfig)
    private readonly configRepo: Repository<StoreConfig>,
    @InjectRepository(ResponseTemplate)
    private readonly templateRepo: Repository<ResponseTemplate>,
    @InjectRepository(PhraseBlock)
    private readonly phraseBlockRepo: Repository<PhraseBlock>,
    @InjectRepository(FaqItem)
    private readonly faqItemRepo: Repository<FaqItem>,
  ) {}

  // ─── Store Config ──────────────────────────────────────────────

  @Get('config')
  async getConfig(@CurrentUser() user: JwtPayload) {
    let config = await this.configRepo.findOne({
      where: { tenantId: user.tenantId },
    });
    if (!config) {
      config = this.configRepo.create({ tenantId: user.tenantId });
      config = await this.configRepo.save(config);
    }
    return config;
  }

  @Patch('config')
  async updateConfig(
    @CurrentUser() user: JwtPayload,
    @Body() body: Partial<StoreConfig>,
  ) {
    let config = await this.configRepo.findOne({
      where: { tenantId: user.tenantId },
    });
    if (!config) {
      config = this.configRepo.create({ tenantId: user.tenantId });
    }
    if (body.brandConfig !== undefined)
      config.brandConfig = body.brandConfig as any;
    if (body.flowConfig !== undefined)
      config.flowConfig = body.flowConfig as any;
    if (body.checkoutConfig !== undefined)
      config.checkoutConfig = body.checkoutConfig as any;
    if (body.escalationConfig !== undefined)
      config.escalationConfig = body.escalationConfig as any;
    if (body.recommendationConfig !== undefined)
      config.recommendationConfig = body.recommendationConfig as any;
    if (body.handoffConfig !== undefined)
      config.handoffConfig = body.handoffConfig as any;
    if (body.fallbackConfig !== undefined)
      config.fallbackConfig = body.fallbackConfig as any;
    if (body.operatingMode !== undefined) {
      config.operatingMode = body.operatingMode;
      if (body.operatingMode === 'learning' && !config.learningStartedAt) {
        config.learningStartedAt = new Date();
        config.learningNotifiedAt = null;
      } else if (body.operatingMode === 'active') {
        config.learningStartedAt = null;
        config.learningNotifiedAt = null;
      }
    }
    return this.configRepo.save(config);
  }

  // ─── Response Templates ────────────────────────────────────────

  @Get('templates')
  getTemplates(@CurrentUser() user: JwtPayload) {
    return this.templateRepo.find({
      where: { tenantId: user.tenantId },
      order: { scenario: 'ASC', priority: 'DESC' },
    });
  }

  @Post('templates')
  createTemplate(
    @CurrentUser() user: JwtPayload,
    @Body() body: Partial<ResponseTemplate>,
  ) {
    const template = this.templateRepo.create({
      ...body,
      tenantId: user.tenantId,
    });
    return this.templateRepo.save(template);
  }

  @Patch('templates/:id')
  async updateTemplate(
    @Param('id') id: string,
    @Body() body: Partial<ResponseTemplate>,
  ) {
    await this.templateRepo.update(id, body as any);
    return this.templateRepo.findOneBy({ id });
  }

  @Delete('templates/:id')
  async deleteTemplate(@Param('id') id: string) {
    await this.templateRepo.delete(id);
    return { deleted: true };
  }

  // ─── Phrase Blocks ─────────────────────────────────────────────

  @Get('phrase-blocks')
  getPhraseBlocks(@CurrentUser() user: JwtPayload) {
    return this.phraseBlockRepo.find({
      where: { tenantId: user.tenantId },
      order: { type: 'ASC' },
    });
  }

  @Post('phrase-blocks')
  createPhraseBlock(
    @CurrentUser() user: JwtPayload,
    @Body() body: Partial<PhraseBlock>,
  ) {
    const block = this.phraseBlockRepo.create({
      ...body,
      tenantId: user.tenantId,
    });
    return this.phraseBlockRepo.save(block);
  }

  @Delete('phrase-blocks/:id')
  async deletePhraseBlock(@Param('id') id: string) {
    await this.phraseBlockRepo.delete(id);
    return { deleted: true };
  }

  // ─── FAQ Items ─────────────────────────────────────────────────

  @Get('faq')
  getFaqItems(@CurrentUser() user: JwtPayload) {
    return this.faqItemRepo.find({
      where: { tenantId: user.tenantId },
    });
  }

  @Post('faq')
  createFaqItem(
    @CurrentUser() user: JwtPayload,
    @Body() body: Partial<FaqItem>,
  ) {
    const item = this.faqItemRepo.create({
      ...body,
      tenantId: user.tenantId,
    });
    return this.faqItemRepo.save(item);
  }

  @Patch('faq/:id')
  async updateFaqItem(
    @Param('id') id: string,
    @Body() body: Partial<FaqItem>,
  ) {
    await this.faqItemRepo.update(id, body as any);
    return this.faqItemRepo.findOneBy({ id });
  }

  @Delete('faq/:id')
  async deleteFaqItem(@Param('id') id: string) {
    await this.faqItemRepo.delete(id);
    return { deleted: true };
  }
}
