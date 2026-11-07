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
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { memoryStorage } from 'multer';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';
import { OnboardingService } from './onboarding.service';
import { TestChatService } from './test-chat.service';
import { NotesDrafterService } from './notes-drafter.service';
import { CHECKOUT_FIELDS, NOTE_SECTIONS, WEEK_DAYS, type NotesDraft } from './store-notes';

class HelpDto {
  @IsOptional()
  @IsString()
  @MaxLength(40)
  step?: string;
}

class DraftNotesDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  websiteUrl?: string;
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
    return this.onboarding.requestHelp(user.tenantId, user.email, dto.step);
  }

  // ─── «Що знає бот»: AI draft, then a short chat ──────────────

  @Get('notes')
  getNotes(@CurrentUser() user: JwtPayload) {
    return this.notes.get(user.tenantId);
  }

  @Post('notes/draft')
  @HttpCode(200)
  draftNotes(@CurrentUser() user: JwtPayload, @Body() dto: DraftNotesDto) {
    return this.notes.draft(user.tenantId, dto.websiteUrl?.trim() || null);
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
    await this.notes.apply(user.tenantId, validDraft(dto.draft));
    return this.onboarding.status(user.tenantId);
  }

  // ─── «Спробуйте свого бота» ─────────────────────────────────

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

/** Keep only the known fields, with the right types and sane lengths. */
function validDraft(raw: unknown): NotesDraft {
  if (!raw || typeof raw !== 'object') throw new BadRequestException('No notes to save');
  const d = raw as Record<string, any>;
  const text = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
  const sections: NotesDraft['sections'] = {};
  for (const key of NOTE_SECTIONS) {
    const value = text(d.sections?.[key], 3000);
    if (value) sections[key] = value;
  }
  const hours =
    d.businessHours && typeof d.businessHours === 'object'
      ? Object.fromEntries(
          Object.entries(d.businessHours as Record<string, unknown>)
            .filter(([day, h]) => (WEEK_DAYS as readonly string[]).includes(day) && typeof h === 'string')
            .map(([day, h]) => [day, (h as string).slice(0, 20)]),
        )
      : null;
  return {
    sections,
    paymentDetails: text(d.paymentDetails, 1000),
    checkoutFields: Array.isArray(d.checkoutFields)
      ? d.checkoutFields.filter((f: unknown): f is NotesDraft['checkoutFields'][number] => (CHECKOUT_FIELDS as readonly unknown[]).includes(f))
      : [],
    businessHours: hours && Object.keys(hours).length > 0 ? hours : null,
    sizingAdvice: d.sizingAdvice === 'recommend' || d.sizingAdvice === 'consult' ? d.sizingAdvice : null,
    questions: Array.isArray(d.questions) ? d.questions.filter((q: unknown) => typeof q === 'string').slice(0, 8) : [],
    sources: Array.isArray(d.sources) ? d.sources.filter((q: unknown) => typeof q === 'string').slice(0, 10) : [],
  };
}

