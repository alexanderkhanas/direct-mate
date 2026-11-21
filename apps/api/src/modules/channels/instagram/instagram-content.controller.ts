import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { isUUID } from 'class-validator';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { InternalApiKeyGuard } from '../../../common/guards/internal-api-key.guard';
import { CurrentUser, JwtPayload } from '../../../common/decorators/current-user.decorator';
import { InstagramContentService } from './instagram-content.service';
import { IntegrationsService } from '../../integrations/integrations.service';

@ApiTags('instagram')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
@Controller('instagram/media-mappings')
export class InstagramContentController {
  constructor(private readonly contentService: InstagramContentService) {}

  @Get()
  findAll(
    @CurrentUser() user: JwtPayload,
    @Query('filter') filter?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.contentService.findAll(user.tenantId, {
      filter: filter === 'review' || filter === 'unlinked' || filter === 'linked' ? filter : undefined,
      limit: limit ? parseInt(limit, 10) || 50 : 50,
      offset: offset ? parseInt(offset, 10) || 0 : 0,
    });
  }

  /** The owner links a product (a colour, or every colour) to a piece of content: confirmed. */
  @Post(':id/products')
  linkProduct(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { productId: string; color?: string | null },
  ) {
    if (!body?.productId || !isUUID(body.productId)) throw new BadRequestException('productId is required');
    return this.contentService.linkProduct(user.tenantId, id, body.productId, body.color ?? null);
  }

  /** «Так, це він» / «Ні»: the owner confirms or rejects one of the content's products. */
  @Patch(':id/products/:linkId')
  setLinkStatus(
    @CurrentUser() user: JwtPayload,
    @Param('linkId', ParseUUIDPipe) linkId: string,
    @Body() body: { status: string },
  ) {
    if (body?.status !== 'confirmed' && body?.status !== 'rejected') {
      throw new BadRequestException('status must be confirmed or rejected');
    }
    return this.contentService.setLinkStatus(user.tenantId, linkId, body.status);
  }

  @Delete(':id')
  remove(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ) {
    return this.contentService.deleteMapping(id, user.tenantId);
  }

  @Post()
  create(
    @CurrentUser() user: JwtPayload,
    @Body() body: { instagramMediaId: string; mediaType?: string; caption?: string; productId?: string },
  ) {
    return this.contentService.createManualMapping(user.tenantId, body);
  }

  /** «Fetch content»: the scheduled fetch for this store, now. Vision for new stories runs after the response. */
  @Post('fetch')
  fetch(@CurrentUser() user: JwtPayload) {
    return this.contentService.fetchContent(user.tenantId);
  }

  @Post('parse-link')
  parseLink(@Body() body: { url: string }) {
    return this.contentService.parseInstagramLink(body.url);
  }
}

// ─── Internal endpoint (n8n: token renewal) ──────────────────
// Content fetching is an in-process cron (InstagramContentService.tick), not n8n.
// Token renewal runs in process too (daily); this runs the same pass on demand.

@ApiTags('internal/instagram')
@UseGuards(InternalApiKeyGuard)
@Controller('internal/instagram')
export class InternalInstagramContentController {
  constructor(private readonly integrationsService: IntegrationsService) {}

  @Post('refresh-tokens')
  refreshTokens() {
    return this.integrationsService.refreshInstagramTokens();
  }
}
