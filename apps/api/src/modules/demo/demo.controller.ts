import {
  Body,
  Controller,
  HttpCode,
  HttpException,
  HttpStatus,
  Ip,
  NotFoundException,
  Post,
  Res,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { DemoMessageDto } from './dto/demo-message.dto';
import { DemoService, DEFAULT_DEMO_TENANT_SLUG } from './demo.service';
import { DemoMessageBufferService, DemoReplyPayload } from './demo-message-buffer.service';
import { DemoRateLimiterService } from './demo-rate-limiter.service';

@ApiTags('demo')
@Controller('demo')
export class DemoController {
  constructor(
    private readonly demoService: DemoService,
    private readonly bufferService: DemoMessageBufferService,
    private readonly rateLimiter: DemoRateLimiterService,
  ) {}

  @Post('message')
  @HttpCode(200)
  async message(
    @Body() dto: DemoMessageDto,
    @Ip() ip: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<DemoReplyPayload> {
    if (!this.demoService.hasAnyTenant()) {
      throw new ServiceUnavailableException(
        'No demo tenants provisioned. Run the demo seed scripts.',
      );
    }

    const slug = dto.tenantSlug ?? DEFAULT_DEMO_TENANT_SLUG;
    const tenantId = this.demoService.getTenantId(slug);
    if (!tenantId) {
      throw new NotFoundException(`Demo tenant not found: ${slug}`);
    }

    const decision = this.rateLimiter.acceptSession(ip, dto.sessionKey, slug);
    if (!decision.ok) {
      res.setHeader('Retry-After', String(decision.retryAfterSeconds));
      throw new HttpException(
        { error: 'rate_limit', retryAfterSeconds: decision.retryAfterSeconds },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return this.bufferService.appendAndSchedule(tenantId, dto.sessionKey, dto.text);
  }
}
