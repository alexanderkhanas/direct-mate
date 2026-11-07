import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsString, IsUrl, MaxLength } from 'class-validator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';
import { FeedError } from './feed-fetcher';
import { FeedSyncService } from './feed-sync.service';

class FeedUrlDto {
  @IsString()
  @MaxLength(2000)
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  url!: string;
}

/** Owner-facing: paste a feed or Google Sheet link, preview it, connect it, see how syncs went. */
@ApiTags('catalog-feeds')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
@Controller('catalog/feeds')
export class CatalogFeedsController {
  constructor(private readonly feeds: FeedSyncService) {}

  @Post('preview')
  @HttpCode(200)
  preview(@CurrentUser() user: JwtPayload, @Body() dto: FeedUrlDto) {
    return this.explain(this.feeds.preview(user.tenantId, dto.url));
  }

  @Post()
  connect(@CurrentUser() user: JwtPayload, @Body() dto: FeedUrlDto) {
    return this.explain(this.feeds.connect(user.tenantId, dto.url));
  }

  @Get()
  status(@CurrentUser() user: JwtPayload) {
    return this.feeds.status(user.tenantId);
  }

  @Post(':id/sync')
  @HttpCode(200)
  async sync(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    const current = await this.feeds.status(user.tenantId);
    if (current.feed?.id !== id) throw new BadRequestException('No such feed');
    return { ...(await this.feeds.sync(id, { force: true })), ...(await this.feeds.status(user.tenantId)) };
  }

  @Delete(':id')
  async disconnect(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    await this.feeds.disconnect(user.tenantId, id);
    return { success: true };
  }

  /** Feed problems come back as `details.code` (what AllExceptionsFilter passes through), which the admin translates. */
  private async explain<T>(work: Promise<T>): Promise<T> {
    try {
      return await work;
    } catch (err) {
      if (err instanceof FeedError) throw new BadRequestException({ message: err.message, details: { code: err.code } });
      throw err;
    }
  }
}
