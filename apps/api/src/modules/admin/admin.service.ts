import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Tenant } from '../tenants/entities/tenant.entity';
import { User } from '../tenants/entities/user.entity';
import { Conversation } from '../conversations/entities/conversation.entity';
import { Order } from '../orders/entities/order.entity';
import { Connection } from '../integrations/entities/connection.entity';
import { Message } from '../conversations/entities/message.entity';
import { SubscriptionPlan } from '../subscriptions/entities/subscription-plan.entity';

const SYSTEM_TENANT_ID = '00000000-0000-0000-0000-000000000000';

@Injectable()
export class AdminService {
  constructor(
    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(Conversation)
    private readonly conversationRepo: Repository<Conversation>,
    @InjectRepository(Order)
    private readonly orderRepo: Repository<Order>,
    @InjectRepository(Connection)
    private readonly connectionRepo: Repository<Connection>,
    @InjectRepository(Message)
    private readonly messageRepo: Repository<Message>,
    @InjectRepository(SubscriptionPlan)
    private readonly planRepo: Repository<SubscriptionPlan>,
    private readonly dataSource: DataSource,
  ) {}

  async listTenants() {
    const tenants = await this.tenantRepo.find({
      order: { createdAt: 'DESC' },
    });

    const filtered = tenants.filter((t) => t.id !== SYSTEM_TENANT_ID);

    return Promise.all(
      filtered.map(async (tenant) => {
        const [conversationCount, orderCount, connections, plan] = await Promise.all([
          this.conversationRepo.count({ where: { tenantId: tenant.id } }),
          this.orderRepo.count({ where: { tenantId: tenant.id } }),
          this.connectionRepo.find({ where: { tenantId: tenant.id } }),
          this.planRepo.findOne({ where: { tenantId: tenant.id } }),
        ]);

        return {
          id: tenant.id,
          name: tenant.name,
          slug: tenant.slug,
          businessType: tenant.businessType,
          isActive: tenant.isActive,
          createdAt: tenant.createdAt,
          conversationCount,
          orderCount,
          connections: connections.map((c) => ({
            type: c.type,
            status: c.status,
          })),
          subscription: plan ? {
            planType: plan.planType,
            status: plan.status,
            trialEndsAt: plan.trialEndsAt,
            currentPeriodEnd: plan.currentPeriodEnd,
            conversationLimit: plan.conversationLimit,
          } : null,
        };
      }),
    );
  }

  async getTenantDetails(tenantId: string) {
    const tenant = await this.tenantRepo.findOne({ where: { id: tenantId } });
    if (!tenant) return null;

    const [users, connections, recentConversations, orderCount] =
      await Promise.all([
        this.userRepo.find({ where: { tenantId } }),
        this.connectionRepo.find({ where: { tenantId } }),
        this.conversationRepo
          .createQueryBuilder('c')
          .innerJoinAndSelect('c.customer', 'cust')
          .where('c.tenant_id = :tenantId', { tenantId })
          .orderBy('c.lastMessageAt', 'DESC')
          .take(10)
          .getMany(),
        this.orderRepo.count({ where: { tenantId } }),
      ]);

    return {
      id: tenant.id,
      name: tenant.name,
      slug: tenant.slug,
      businessType: tenant.businessType,
      timezone: tenant.timezone,
      isActive: tenant.isActive,
      createdAt: tenant.createdAt,
      updatedAt: tenant.updatedAt,
      users: users.map((u) => ({
        id: u.id,
        email: u.email,
        role: u.role,
        isActive: u.isActive,
        createdAt: u.createdAt,
      })),
      connections: connections.map((c) => ({
        id: c.id,
        type: c.type,
        status: c.status,
        lastSyncAt: c.lastSyncAt,
        createdAt: c.createdAt,
      })),
      recentConversations: recentConversations.map((c) => ({
        id: c.id,
        status: c.status,
        needsHandoff: c.needsHandoff,
        lastMessageAt: c.lastMessageAt,
        customer: c.customer
          ? {
              id: c.customer.id,
              username: c.customer.username,
              fullName: c.customer.fullName,
            }
          : null,
      })),
      orderCount,
    };
  }

  async getGlobalStats() {
    const [
      totalTenants,
      activeTenants,
      totalConversations,
      handoffConversations,
      totalOrders,
      revenueResult,
    ] = await Promise.all([
      this.tenantRepo
        .createQueryBuilder('t')
        .where('t.id != :systemId', { systemId: SYSTEM_TENANT_ID })
        .getCount(),
      this.tenantRepo
        .createQueryBuilder('t')
        .where('t.id != :systemId', { systemId: SYSTEM_TENANT_ID })
        .andWhere('t.is_active = true')
        .getCount(),
      this.conversationRepo.count(),
      this.conversationRepo.count({ where: { needsHandoff: true } }),
      this.orderRepo.count(),
      this.orderRepo
        .createQueryBuilder('o')
        .select('COALESCE(SUM(o.total_amount), 0)', 'total')
        .getRawOne() as Promise<{ total: string }>,
    ]);

    const automatedConversations = totalConversations - handoffConversations;

    return {
      totalTenants,
      activeTenants,
      totalConversations,
      totalOrders,
      totalRevenue: parseFloat(revenueResult?.total ?? '0'),
      automationRate:
        totalConversations > 0
          ? +(automatedConversations / totalConversations).toFixed(4)
          : 0,
      handoffRate:
        totalConversations > 0
          ? +(handoffConversations / totalConversations).toFixed(4)
          : 0,
    };
  }

  async getTenantConversations(
    tenantId: string,
    filters: {
      status?: string;
      needsHandoff?: boolean;
      page?: number;
      limit?: number;
    },
  ) {
    const { page = 1, limit = 20 } = filters;
    const qb = this.conversationRepo
      .createQueryBuilder('c')
      .innerJoinAndSelect('c.customer', 'cust')
      .where('c.tenant_id = :tenantId', { tenantId })
      .orderBy('c.lastMessageAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    if (filters.status)
      qb.andWhere('c.status = :status', { status: filters.status });
    if (filters.needsHandoff !== undefined) {
      qb.andWhere('c.needs_handoff = :needsHandoff', {
        needsHandoff: filters.needsHandoff,
      });
    }

    const [items, total] = await qb.getManyAndCount();
    return { items, page, limit, total };
  }

  async getTenantOrders(tenantId: string) {
    return this.orderRepo.find({
      where: { tenantId },
      relations: ['items'],
      order: { createdAt: 'DESC' },
    });
  }

  async updateSubscription(
    tenantId: string,
    updates: { planType?: string; status?: string; conversationLimit?: number | null },
  ) {
    let plan = await this.planRepo.findOne({ where: { tenantId } });
    if (!plan) {
      plan = this.planRepo.create({ tenantId, planType: 'trial', status: 'active' });
    }
    if (updates.planType !== undefined) plan.planType = updates.planType;
    if (updates.status !== undefined) plan.status = updates.status;
    if (updates.conversationLimit !== undefined) plan.conversationLimit = updates.conversationLimit;
    return this.planRepo.save(plan);
  }

  async getAdminAnalytics() {
    const [
      globalStats,
      planBreakdown,
      recentSignups,
      topTenants,
      dailyConversations,
    ] = await Promise.all([
      this.getGlobalStats(),
      // Plan distribution
      this.planRepo
        .createQueryBuilder('p')
        .select('p.plan_type', 'planType')
        .addSelect('p.status', 'status')
        .addSelect('COUNT(*)', 'count')
        .groupBy('p.plan_type')
        .addGroupBy('p.status')
        .getRawMany() as Promise<Array<{ planType: string; status: string; count: string }>>,
      // Recent signups (last 30 days)
      this.tenantRepo
        .createQueryBuilder('t')
        .where('t.id != :systemId', { systemId: SYSTEM_TENANT_ID })
        .andWhere('t.created_at > :since', { since: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) })
        .orderBy('t.created_at', 'DESC')
        .take(10)
        .getMany(),
      // Top tenants by conversation count
      this.dataSource.query(`
        SELECT t.id, t.name, t.slug,
          COUNT(DISTINCT c.id) as conversation_count,
          COUNT(DISTINCT o.id) as order_count,
          sp.plan_type, sp.status as plan_status
        FROM tenants t
        LEFT JOIN conversations c ON c.tenant_id = t.id
        LEFT JOIN orders o ON o.tenant_id = t.id
        LEFT JOIN subscription_plans sp ON sp.tenant_id = t.id
        WHERE t.id != $1
        GROUP BY t.id, t.name, t.slug, sp.plan_type, sp.status
        ORDER BY conversation_count DESC
        LIMIT 10
      `, [SYSTEM_TENANT_ID]),
      // Daily conversations (last 30 days)
      this.dataSource.query(`
        SELECT DATE(created_at) as date, COUNT(*) as count
        FROM conversations
        WHERE created_at > NOW() - INTERVAL '30 days'
        GROUP BY DATE(created_at)
        ORDER BY date ASC
      `),
    ]);

    // Aggregate plan distribution
    const planDistribution: Record<string, { active: number; trial: number; pastDue: number; cancelled: number; expired: number }> = {};
    for (const row of planBreakdown) {
      if (!planDistribution[row.planType]) {
        planDistribution[row.planType] = { active: 0, trial: 0, pastDue: 0, cancelled: 0, expired: 0 };
      }
      const count = parseInt(row.count, 10);
      if (row.status === 'active') planDistribution[row.planType].active = count;
      else if (row.status === 'past_due') planDistribution[row.planType].pastDue = count;
      else if (row.status === 'cancelled') planDistribution[row.planType].cancelled = count;
      else if (row.status === 'expired') planDistribution[row.planType].expired = count;
    }

    return {
      ...globalStats,
      planDistribution,
      recentSignups: recentSignups.map(t => ({
        id: t.id,
        name: t.name,
        slug: t.slug,
        createdAt: t.createdAt,
      })),
      topTenants,
      dailyConversations,
    };
  }

  async getTenantOwner(tenantId: string) {
    return this.userRepo.findOne({
      where: { tenantId, role: 'owner' as any },
    });
  }
}
