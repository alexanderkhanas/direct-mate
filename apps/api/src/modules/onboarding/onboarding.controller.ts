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

class HelpDto {
  @IsOptional()
  @IsString()
  @MaxLength(40)
  step?: string;
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
