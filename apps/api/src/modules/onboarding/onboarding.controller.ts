import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { memoryStorage } from 'multer';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';
import { HELP_TOPICS, OnboardingService, type HelpTopic } from './onboarding.service';
import { TestChatService } from './test-chat.service';
import { NotesDrafterService } from './notes-drafter.service';
import { validDraft, type NotesDraft } from './store-notes';
import { HistoryImportService } from './history/history-import.service';

class HelpDto {
  @IsOptional()
  @IsString()
  @MaxLength(40)
  step?: string;

  @IsOptional()
  @IsIn(HELP_TOPICS)
  topic?: HelpTopic;
}

class DraftNotesDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  websiteUrl?: string;

  /** What the shop already sends customers about delivery and payment, pasted by the owner. */
  @IsOptional()
  @IsString()
  @MaxLength(8000)
  text?: string;
}

class NotesMessageDto {
  @IsString()
  @MaxLength(2000)
  message!: string;
}

/** The owner's edited draft; shape-checked by NotesDrafterService before anything is written. */
class NotesDraftDto {
  @IsOptional()
  draft?: NotesDraft;
}

class HistoryConsentDto {
  @IsBoolean()
  read!: boolean;
}

class HistoryExampleDto {
  @IsString()
  @MaxLength(1000)
  customer!: string;

  @IsString()
  @MaxLength(1000)
  manager!: string;
}

/** The tone and examples the owner approved, possibly edited. */
class HistoryApplyDto {
  @IsString()
  @MaxLength(2000)
  tone!: string;

  @IsArray()
  @ArrayMaxSize(8)
  @ValidateNested({ each: true })
  @Type(() => HistoryExampleDto)
  examples!: HistoryExampleDto[];
}

class TestMessageDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  text?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  photoUrl?: string;
}

@ApiTags('onboarding')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
@Controller('onboarding')
export class OnboardingController {
  constructor(
    private readonly onboarding: OnboardingService,
    private readonly testChat: TestChatService,
    private readonly notes: NotesDrafterService,
    private readonly history: HistoryImportService,
  ) {}

  @Get('status')
  status(@CurrentUser() user: JwtPayload) {
    return this.onboarding.status(user.tenantId);
  }

  @Post('steps/:key/skip')
  @HttpCode(200)
  async skip(@CurrentUser() user: JwtPayload, @Param('key') key: string) {
    await this.onboarding.skip(user.tenantId, key);
    return this.onboarding.status(user.tenantId);
  }

  @Post('help')
  @HttpCode(200)
  help(@CurrentUser() user: JwtPayload, @Body() dto: HelpDto) {
    return this.onboarding.requestHelp(user.tenantId, user.email, dto.step, dto.topic);
  }

  // ─── «Що знає AI-агент»: AI draft, then a short chat ──────────────

  @Get('notes')
  getNotes(@CurrentUser() user: JwtPayload) {
    return this.notes.get(user.tenantId);
  }

  @Post('notes/draft')
  @HttpCode(200)
  draftNotes(@CurrentUser() user: JwtPayload, @Body() dto: DraftNotesDto) {
    return this.notes.draft(user.tenantId, { websiteUrl: dto.websiteUrl?.trim() || null, text: dto.text?.trim() || null });
  }

  @Post('notes/chat')
  @HttpCode(200)
  notesChat(@CurrentUser() user: JwtPayload, @Body() dto: NotesMessageDto) {
    return this.notes.chat(user.tenantId, dto.message);
  }

  @Post('notes/update')
  @HttpCode(200)
  async updateNotes(@CurrentUser() user: JwtPayload, @Body() dto: NotesDraftDto) {
    await this.notes.update(user.tenantId, validDraft(dto.draft));
    return { ok: true };
  }

  @Post('notes/save')
  @HttpCode(200)
  async saveNotes(@CurrentUser() user: JwtPayload, @Body() dto: NotesDraftDto) {
    const draft = validDraft(dto.draft);
    // Keep the saved version as the draft too, so coming back to the step shows what was saved.
    await this.notes.update(user.tenantId, draft);
    await this.notes.apply(user.tenantId, draft);
    return this.onboarding.status(user.tenantId);
  }

  // ─── Instagram history: read recent chats once, learn the terms and the tone ───

  @Get('history')
  getHistory(@CurrentUser() user: JwtPayload) {
    return this.history.get(user.tenantId);
  }

  @Post('history/consent')
  @HttpCode(200)
  historyConsent(@CurrentUser() user: JwtPayload, @Body() dto: HistoryConsentDto) {
    return this.history.setConsent(user.tenantId, dto.read);
  }

  @Post('history/import')
  @HttpCode(200)
  historyImport(@CurrentUser() user: JwtPayload) {
    return this.history.request(user.tenantId);
  }

  @Post('history/apply')
  @HttpCode(200)
  async historyApply(@CurrentUser() user: JwtPayload, @Body() dto: HistoryApplyDto) {
    await this.history.apply(user.tenantId, { tone: dto.tone, examples: dto.examples });
    return this.onboarding.status(user.tenantId);
  }

  // ─── «Спробуйте свого AI-агента» ─────────────────────────────────

  @Get('test-chat')
  async testChatHistory(@CurrentUser() user: JwtPayload) {
    return { messages: await this.testChat.history(user.tenantId) };
  }

  @Post('test-chat/message')
  @HttpCode(200)
  testChatMessage(@CurrentUser() user: JwtPayload, @Body() dto: TestMessageDto) {
    return this.testChat.send(user.tenantId, dto);
  }

  @Post('test-chat/photo')
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } }))
  testChatPhoto(@CurrentUser() user: JwtPayload, @UploadedFile() file: Express.Multer.File | undefined) {
    if (!file) throw new BadRequestException('No file uploaded');
    return this.testChat.uploadPhoto(user.tenantId, file.buffer);
  }

  @Post('test-chat/reset')
  @HttpCode(200)
  async testChatReset(@CurrentUser() user: JwtPayload) {
    await this.testChat.reset(user.tenantId);
    return { ok: true };
  }
}
