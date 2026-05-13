import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
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
    @Query('linked') linked?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.contentService.findAll(user.tenantId, {
      linked: linked === 'true' ? true : linked === 'false' ? false : undefined,
      limit: limit ? parseInt(limit, 10) : 50,
      offset: offset ? parseInt(offset, 10) : 0,
    });
  }

  @Patch(':id')
  update(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() body: { productId?: string | null; variantId?: string | null; linkedColor?: string | null; confirmed?: boolean },
  ) {
    return this.contentService.updateMapping(id, user.tenantId, body);
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

  @Post('fetch')
  fetch(@CurrentUser() user: JwtPayload) {
    return this.contentService.fetchContent(user.tenantId);
  }

  @Post('parse-link')
  parseLink(@Body() body: { url: string }) {
    return this.contentService.parseInstagramLink(body.url);
  }
}

// ─── Internal endpoint (n8n cron) ─────────────────────────────

@ApiTags('internal/instagram')
@UseGuards(InternalApiKeyGuard)
@Controller('internal/instagram')
export class InternalInstagramContentController {
  constructor(
    private readonly contentService: InstagramContentService,
    private readonly integrationsService: IntegrationsService,
  ) {}

  @Post('fetch-content')
  fetchContent(@Body() body?: { tenantId?: string }) {
    if (body?.tenantId) {
      return this.contentService.fetchContent(body.tenantId);
    }
    return this.contentService.fetchContentForAllTenants();
  }

  @Post('refresh-tokens')
  refreshTokens() {
    return this.integrationsService.refreshExpiringTokens();
  }
}
