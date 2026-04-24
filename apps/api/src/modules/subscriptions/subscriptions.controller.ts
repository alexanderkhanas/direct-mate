import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';
import { SubscriptionsService } from './subscriptions.service';
import { MonoPaymentService } from './mono-payment.service';
import { Request } from 'express';

@ApiTags('subscriptions')
@Controller('subscriptions')
export class SubscriptionsController {
  constructor(
    private readonly subscriptionsService: SubscriptionsService,
    private readonly monoService: MonoPaymentService,
  ) {}

  @Get('plan')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  getPlan(@CurrentUser() user: JwtPayload) {
    return this.subscriptionsService.getPlanForTenant(user.tenantId);
  }

  @Get('plans')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  getAvailablePlans() {
    return this.subscriptionsService.getPlanConfigs();
  }

  @Post('upgrade')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  upgrade(
    @CurrentUser() user: JwtPayload,
    @Body() body: { planType: string },
  ) {
    return this.subscriptionsService.createUpgradeSubscription(user.tenantId, body.planType);
  }

  @Post('cancel')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  cancel(@CurrentUser() user: JwtPayload) {
    return this.subscriptionsService.cancelPlan(user.tenantId);
  }

  // ─── Mono webhooks (public, signature-verified) ──────────────────

  @Post('webhook/charge')
  async handleCharge(@Req() req: Request) {
    const signature = req.headers['x-sign'] as string;
    const rawBody = (req as any).rawBody as Buffer | undefined;

    if (!signature || !rawBody) {
      throw new BadRequestException('Missing signature or body');
    }

    const valid = await this.monoService.verifySignature(rawBody, signature);
    if (!valid) {
      throw new BadRequestException('Invalid signature');
    }

    const payload = JSON.parse(rawBody.toString());
    await this.subscriptionsService.handleChargeWebhook(payload);
    return { ok: true };
  }

  @Post('webhook/status')
  async handleStatus(@Req() req: Request) {
    const signature = req.headers['x-sign'] as string;
    const rawBody = (req as any).rawBody as Buffer | undefined;

    if (!signature || !rawBody) {
      throw new BadRequestException('Missing signature or body');
    }

    const valid = await this.monoService.verifySignature(rawBody, signature);
    if (!valid) {
      throw new BadRequestException('Invalid signature');
    }

    const payload = JSON.parse(rawBody.toString());
    await this.subscriptionsService.handleStatusWebhook(payload);
    return { ok: true };
  }
}
