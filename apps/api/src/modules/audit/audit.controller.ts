import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AuditService } from './audit.service';

@ApiTags('logs')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
@Controller('logs')
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get('conversation/:id')
  getConversationLogs(@Param('id') id: string) {
    return this.auditService.getConversationLogs(id);
  }
}
