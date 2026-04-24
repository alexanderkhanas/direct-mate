import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
  NotFoundException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { AdminService } from './admin.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';

@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('superadmin')
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    private readonly subscriptionsService: SubscriptionsService,
    private readonly jwtService: JwtService,
  ) {}

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

  // ─── Subscription management ────────────────────────────────────

  @Patch('tenants/:id/subscription')
  async updateSubscription(
    @Param('id') tenantId: string,
    @Body() body: { planType?: string; status?: string; conversationLimit?: number | null },
  ) {
    return this.adminService.updateSubscription(tenantId, body);
  }

  // ─── Plan config management ────────────────────────────────────

  @Get('plan-configs')
  getPlanConfigs() {
    return this.subscriptionsService.getPlanConfigs();
  }

  @Patch('plan-configs/:planType')
  updatePlanConfig(
    @Param('planType') planType: string,
    @Body() body: { price?: number; conversationLimit?: number | null; igAccountsLimit?: number; productsLimit?: number | null; connectionsLimit?: number; teamMembersLimit?: number; historyDays?: number; displayName?: string; isActive?: boolean },
  ) {
    return this.subscriptionsService.updatePlanConfig(planType, body);
  }

  // ─── Enhanced analytics ────────────────────────────────────────

  @Get('analytics')
  getAdminAnalytics() {
    return this.adminService.getAdminAnalytics();
  }

  // ─── Impersonation: generate token to view tenant's admin panel ──

  @Post('tenants/:id/impersonate')
  async impersonate(@Param('id') tenantId: string) {
    const user = await this.adminService.getTenantOwner(tenantId);
    if (!user) throw new NotFoundException('No owner found for this tenant');

    const token = this.jwtService.sign({
      sub: user.id,
      email: user.email,
      role: user.role,
      tenantId,
    });

    return { accessToken: token };
  }
}
