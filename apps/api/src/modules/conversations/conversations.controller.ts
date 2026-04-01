import {
  Body,
  Controller,
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
import { TakeoverDto } from './dto/takeover.dto';

@ApiTags('conversations')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
@Controller('conversations')
export class ConversationsController {
  constructor(private readonly conversationsService: ConversationsService) {}

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
}
