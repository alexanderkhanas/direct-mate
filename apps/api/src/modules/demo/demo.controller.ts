import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Ip,
  NotFoundException,
  Post,
  Query,
  Res,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { DemoMessageDto } from './dto/demo-message.dto';
import { DemoService, DEFAULT_DEMO_TENANT_SLUG } from './demo.service';
import { DemoMessageBufferService, DemoReplyPayload } from './demo-message-buffer.service';
import { DemoRateLimiterService } from './demo-rate-limiter.service';
import { CatalogService } from '../catalog/catalog.service';

@ApiTags('demo')
@Controller('demo')
export class DemoController {
  constructor(
    private readonly demoService: DemoService,
    private readonly bufferService: DemoMessageBufferService,
    private readonly rateLimiter: DemoRateLimiterService,
    private readonly catalogService: CatalogService,
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

  @Get('catalog')
  async catalog(
    @Query('tenantSlug') tenantSlug?: string,
  ): Promise<{
    products: Array<{
      id: string;
      title: string;
      category: string | null;
      imageUrl: string | null;
      priceFrom: number | null;
      currency: string;
      colors: string[];
      sizes: string[];
    }>;
  }> {
    if (!this.demoService.hasAnyTenant()) {
      throw new ServiceUnavailableException(
        'No demo tenants provisioned. Run the demo seed scripts.',
      );
    }
    const slug = tenantSlug ?? DEFAULT_DEMO_TENANT_SLUG;
    const tenantId = this.demoService.getTenantId(slug);
    if (!tenantId) {
      throw new NotFoundException(`Demo tenant not found: ${slug}`);
    }

    const products = await this.catalogService.listProducts(tenantId);

    const trimmed = products.slice(0, 30).map((p) => {
      const variants = p.variants ?? [];
      const prices = variants
        .map((v) => Number(v.price))
        .filter((n) => Number.isFinite(n) && n > 0);
      const priceFrom = prices.length > 0 ? Math.min(...prices) : null;
      const currency = variants[0]?.currency ?? 'UAH';
      const colors = Array.from(
        new Set(
          variants
            .map((v) => v.color)
            .filter((c): c is string => !!c && c.trim().length > 0),
        ),
      );
      const sizes = Array.from(
        new Set(
          variants
            .map((v) => v.size)
            .filter((s): s is string => !!s && s.trim().length > 0),
        ),
      );
      return {
        id: p.id,
        title: p.title,
        category: p.category,
        imageUrl: p.imageUrl,
        priceFrom,
        currency,
        colors,
        sizes,
      };
    });

    return { products: trimmed };
  }
}
