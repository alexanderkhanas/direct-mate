import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';
import { SettingsService } from './settings.service';
import { UpdateSettingsDto } from './dto/update-settings.dto';

@ApiTags('settings')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
@Controller('settings')
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get()
  getSettings(@CurrentUser() user: JwtPayload) {
    return this.settingsService.getSettings(user.tenantId);
  }

  @Patch()
  updateSettings(@CurrentUser() user: JwtPayload, @Body() dto: UpdateSettingsDto) {
    return this.settingsService.updateSettings(user.tenantId, dto);
  }

  @Get('examples')
  getExamples(@CurrentUser() user: JwtPayload) {
    return this.settingsService.getExamples(user.tenantId);
  }

  @Post('examples')
  createExample(@CurrentUser() user: JwtPayload, @Body() body: any) {
    return this.settingsService.createExample(user.tenantId, body);
  }

  @Delete('examples/:id')
  deleteExample(@Param('id') id: string) {
    return this.settingsService.deleteExample(id);
  }
}
