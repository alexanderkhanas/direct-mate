import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
  NotFoundException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { AdminService } from './admin.service';

@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('superadmin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('tenants')
  listTenants() {
    return this.adminService.listTenants();
  }

  @Get('tenants/:id')
  async getTenantDetails(@Param('id') id: string) {
    const tenant = await this.adminService.getTenantDetails(id);
    if (!tenant) throw new NotFoundException(`Tenant ${id} not found`);
    return tenant;
  }

  @Get('tenants/:id/conversations')
  getTenantConversations(
    @Param('id') id: string,
    @Query('status') status?: string,
    @Query('needsHandoff') needsHandoff?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.adminService.getTenantConversations(id, {
      status,
      needsHandoff: needsHandoff !== undefined ? needsHandoff === 'true' : undefined,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @Get('tenants/:id/orders')
  getTenantOrders(@Param('id') id: string) {
    return this.adminService.getTenantOrders(id);
  }

  @Get('stats')
  getGlobalStats() {
    return this.adminService.getGlobalStats();
  }
}
