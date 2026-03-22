import {
  Controller,
  Get,
  Patch,
  Post,
  Param,
  Body,
  Query,
  UseGuards,
  NotFoundException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';
import { ExtractedConversationFragment } from './entities/extracted-conversation-fragment.entity';
import { ExtractedPhrase } from './entities/extracted-phrase.entity';
import { ExtractedVoiceSignal } from './entities/extracted-voice-signal.entity';
import { UpdateFragmentReviewDto } from './dto/update-fragment-review.dto';
import { UpdatePhraseDto } from './dto/update-phrase.dto';
import { UpdateVoiceSignalDto } from './dto/update-voice-signal.dto';
import { ScreenshotApprovalService } from './screenshot-approval.service';

@ApiTags('training')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
@Controller('training/screenshots/review')
export class ScreenshotReviewController {
  constructor(
    @InjectRepository(ExtractedConversationFragment)
    private readonly fragmentRepo: Repository<ExtractedConversationFragment>,
    @InjectRepository(ExtractedPhrase)
    private readonly phraseRepo: Repository<ExtractedPhrase>,
    @InjectRepository(ExtractedVoiceSignal)
    private readonly voiceSignalRepo: Repository<ExtractedVoiceSignal>,
    private readonly approvalService: ScreenshotApprovalService,
  ) {}

  @Get('fragments')
  async listFragments(
    @CurrentUser() user: JwtPayload,
    @Query('status') status?: string,
  ) {
    const qb = this.fragmentRepo
      .createQueryBuilder('f')
      .leftJoinAndSelect('f.phrases', 'p')
      .leftJoinAndSelect('f.voiceSignals', 'vs')
      .leftJoinAndSelect('f.file', 'file')
      .where('f.tenant_id = :tenantId', { tenantId: user.tenantId })
      .andWhere('f.review_status != :merged', { merged: 'merged' })
      .orderBy('f.created_at', 'DESC');

    if (status) {
      qb.andWhere('f.review_status = :status', { status });
    }

    return qb.getMany();
  }

  @Get('fragments/:id')
  async getFragment(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ) {
    const fragment = await this.fragmentRepo.findOne({
      where: { id, tenantId: user.tenantId },
      relations: ['phrases', 'voiceSignals', 'file'],
    });
    if (!fragment) {
      throw new NotFoundException('Fragment not found');
    }
    return fragment;
  }

  @Patch('fragments/:id')
  async updateFragment(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: UpdateFragmentReviewDto,
  ) {
    const fragment = await this.fragmentRepo.findOne({
      where: { id, tenantId: user.tenantId },
    });
    if (!fragment) {
      throw new NotFoundException('Fragment not found');
    }
    await this.fragmentRepo.update(id, { reviewStatus: dto.reviewStatus });
    return { success: true };
  }

  @Patch('phrases/:id')
  async updatePhrase(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: UpdatePhraseDto,
  ) {
    const phrase = await this.phraseRepo.findOne({
      where: { id, tenantId: user.tenantId },
    });
    if (!phrase) {
      throw new NotFoundException('Phrase not found');
    }

    const update: Record<string, unknown> = {
      approvalStatus: dto.approvalStatus,
    };
    if (dto.phrase !== undefined) update.phrase = dto.phrase;
    if (dto.scenario !== undefined) update.scenario = dto.scenario;

    await this.phraseRepo.update(id, update as any);
    return { success: true };
  }

  @Patch('voice-signals/:id')
  async updateVoiceSignal(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: UpdateVoiceSignalDto,
  ) {
    const signal = await this.voiceSignalRepo.findOne({
      where: { id, tenantId: user.tenantId },
    });
    if (!signal) {
      throw new NotFoundException('Voice signal not found');
    }

    const update: Record<string, unknown> = {
      approvalStatus: dto.approvalStatus,
    };
    if (dto.signalType !== undefined) update.signalType = dto.signalType;
    if (dto.signalValue !== undefined) update.signalValue = dto.signalValue;
    if (dto.evidenceText !== undefined) update.evidenceText = dto.evidenceText;

    await this.voiceSignalRepo.update(id, update as any);
    return { success: true };
  }

  @Post('fragments/:id/apply')
  async applyFragment(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ) {
    return this.approvalService.applyFragment(id, user.tenantId);
  }
}
