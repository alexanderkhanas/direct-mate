import {
  Body,
  Controller,
  Get,
  Headers,
  Post,
  Query,
  RawBodyRequest,
  Req,
  UnauthorizedException,
} from '@nestjs/common';

import { ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { InstagramService } from './instagram.service';

@ApiTags('channels')
@Controller('channels/instagram')
export class InstagramController {
  constructor(private readonly instagramService: InstagramService) {}

  @Get('webhook')
  verifyWebhook(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
  ) {
    console.log('[WEBHOOK] GET verify:', { mode, token, challenge });
    return this.instagramService.verifyWebhook(mode, token, challenge);
  }

  @Post('webhook')
  async handleWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-hub-signature-256') signature: string,
    @Body() body: Record<string, unknown>,
  ) {
    console.log('[WEBHOOK] POST /channels/instagram/webhook', JSON.stringify(body).substring(0, 800));
    console.log('[WEBHOOK] signature:', signature ? 'present' : 'none');

    if (req.rawBody && signature) {
      const valid = this.instagramService.verifySignature(req.rawBody, signature);
      console.log('[WEBHOOK] signature valid:', valid);
      if (!valid) {
        console.log('[WEBHOOK] REJECTED - invalid signature');
        throw new UnauthorizedException('Invalid webhook signature');
      }
    }

    // Fire-and-forget: acknowledge immediately, process async
    this.instagramService.handleWebhook(body as any).catch((err) => {
      console.error('[WEBHOOK] handleWebhook error:', err);
    });
    return { received: true };
  }
}
