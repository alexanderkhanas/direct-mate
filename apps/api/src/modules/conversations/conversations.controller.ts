import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';
import { ConversationsService } from './conversations.service';
import { ConversationTracesService } from './conversation-traces.service';
import { TakeoverDto } from './dto/takeover.dto';

@ApiTags('conversations')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
@Controller('conversations')
export class ConversationsController {
  constructor(
    private readonly conversationsService: ConversationsService,
    private readonly tracesService: ConversationTracesService,
  ) {}

  @Get()
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'needsHandoff', required: false, type: Boolean })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  findAll(
    @CurrentUser() user: JwtPayload,
    @Query('status') status?: string,
    @Query('needsHandoff') needsHandoff?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.conversationsService.findAll(user.tenantId, {
      status,
      needsHandoff: needsHandoff === 'true' ? true : needsHandoff === 'false' ? false : undefined,
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 20,
    });
  }

  @Get(':id')
  findOne(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.conversationsService.findById(id, user.tenantId);
  }

  @Post(':id/takeover')
  takeover(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() dto: TakeoverDto) {
    return this.conversationsService.takeover(id, user.tenantId, dto.managerUserId);
  }

  @Post(':id/release')
  release(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.conversationsService.release(id, user.tenantId);
  }

  /**
   * Per-turn trace rows for a conversation, newest first. Each row holds
   * the `ctx.trace` step list, classifier output, stage timings, memory
   * snapshots, recent-message window, and any captured error from
   * `ReplyEngineService.process()`.
   *
   * Restricted to super-admins. Tenant-admins don't need engine internals
   * for their own conversations — they have the Messages view. The trace
   * data exposes classifier prompt-engineering details and timings that
   * are platform-operator concerns, not customer-facing.
   *
   * Super-admins inspect any tenant by passing `X-Tenant-Id` (handled by
   * the `CurrentUser` decorator at common/decorators/current-user.decorator.ts).
   */
  @Get(':id/traces')
  async traces(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    if (user.role !== 'superadmin') {
      throw new ForbiddenException('Trace inspection is super-admin only.');
    }
    // Verifies the conversation belongs to the resolved tenant before
    // returning rows. Defense-in-depth even though the listForConversation
    // call also filters by tenantId.
    await this.conversationsService.findById(id, user.tenantId);
    return this.tracesService.listForConversation(user.tenantId, id);
  }
}
