import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';
import { TelegramService } from './telegram.service';

@ApiTags('connections')
@Controller()
export class TelegramController {
  constructor(
    private readonly telegramService: TelegramService,
    private readonly config: ConfigService,
  ) {}

  // ─── Admin-facing endpoints ─────────────────────────────────

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Post('connections/telegram/connect')
  async connect(@CurrentUser() user: JwtPayload) {
    const { deepLink } = await this.telegramService.generateConnectToken(user.tenantId);
    return { deepLink, expiresInSeconds: 600 };
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Get('connections/telegram/status')
  async status(@CurrentUser() user: JwtPayload) {
    return this.telegramService.getConnectionStatus(user.tenantId);
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Delete('connections/telegram/:chatId')
  async disconnect(@CurrentUser() user: JwtPayload, @Param('chatId') chatId: string) {
    await this.telegramService.removeChatId(user.tenantId, chatId);
    return { ok: true };
  }

  // ─── Telegram webhook ───────────────────────────────────────

  @Post('telegram/webhook')
  @HttpCode(200)
  async webhook(
    @Headers('x-telegram-bot-api-secret-token') secretToken: string,
    @Body() body: any,
  ) {
    const expectedSecret = this.config.get<string>('telegram.webhookSecret');
    if (expectedSecret && secretToken !== expectedSecret) {
      throw new ForbiddenException('Invalid webhook secret');
    }

    const message = body?.message;
    if (message?.text && typeof message.text === 'string') {
      const text: string = message.text;
      if (text.startsWith('/start ')) {
        const token = text.slice('/start '.length).trim();
        if (token) {
          const chatId = String(message.chat?.id);
          await this.telegramService.handleStart(token, chatId);
        }
      }
    }

    return { ok: true };
  }
}
