import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { Repository, LessThanOrEqual } from 'typeorm';
import { Cron } from '@nestjs/schedule';
import { SubscriptionPlan } from './entities/subscription-plan.entity';
import { SubscriptionUsage } from './entities/subscription-usage.entity';
import { SubscriptionPlanConfig } from './entities/subscription-plan-config.entity';
import { MonoPaymentService } from './mono-payment.service';

@Injectable()
export class SubscriptionsService {
  private readonly logger = new Logger(SubscriptionsService.name);
  private readonly activePlanCache = new Map<string, { active: boolean; expiresAt: number }>();

  constructor(
    @InjectRepository(SubscriptionPlan)
    private readonly planRepo: Repository<SubscriptionPlan>,
    @InjectRepository(SubscriptionUsage)
    private readonly usageRepo: Repository<SubscriptionUsage>,
    @InjectRepository(SubscriptionPlanConfig)
    private readonly configRepo: Repository<SubscriptionPlanConfig>,
    private readonly monoService: MonoPaymentService,
    private readonly config: ConfigService,
  ) {}

  async getPlanConfigs(): Promise<SubscriptionPlanConfig[]> {
    return this.configRepo.find({ where: { isActive: true }, order: { sortOrder: 'ASC' } });
  }

  async getPlanConfig(planType: string): Promise<SubscriptionPlanConfig | null> {
    return this.configRepo.findOne({ where: { planType } });
  }

  async updatePlanConfig(planType: string, updates: Partial<SubscriptionPlanConfig>): Promise<SubscriptionPlanConfig> {
    await this.configRepo.update({ planType }, updates as any);
    return this.configRepo.findOneOrFail({ where: { planType } });
  }

  // ─── Trial creation ──────────────────────────────────────────────

  async createTrialForTenant(tenantId: string): Promise<SubscriptionPlan> {
    const existing = await this.planRepo.findOne({ where: { tenantId } });
    if (existing) return existing;

    const trialEndsAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
    const plan = this.planRepo.create({
      tenantId,
      planType: 'trial',
      status: 'active',
      trialEndsAt,
      conversationLimit: 1000, // Trial default; matches starter tier
    });
    return this.planRepo.save(plan);
  }

  // ─── Plan status check (cached) ──────────────────────────────────

  async isActive(tenantId: string): Promise<boolean> {
    const cached = this.activePlanCache.get(tenantId);
    if (cached && cached.expiresAt > Date.now()) return cached.active;

    const plan = await this.planRepo.findOne({ where: { tenantId } });
    if (!plan) {
      this.activePlanCache.set(tenantId, { active: true, expiresAt: Date.now() + 5 * 60 * 1000 });
      return true; // No plan row yet (pre-subscription era tenants) → allow
    }

    const now = new Date();
    const gracePeriodMs = 3 * 24 * 60 * 60 * 1000;
    const active =
      (plan.status === 'active' && (plan.planType !== 'trial' || plan.trialEndsAt! > now)) ||
      (plan.status === 'past_due' && plan.currentPeriodEnd! > new Date(now.getTime() - gracePeriodMs));

    this.activePlanCache.set(tenantId, { active, expiresAt: Date.now() + 5 * 60 * 1000 });
    return active;
  }

  invalidateCache(tenantId: string): void {
    this.activePlanCache.delete(tenantId);
  }

  // ─── Plan info ───────────────────────────────────────────────────

  async getPlanForTenant(tenantId: string): Promise<{
    plan: SubscriptionPlan | null;
    usage: { used: number; limit: number | null; percentUsed: number | null };
    planConfig: SubscriptionPlanConfig | null;
    trialDaysRemaining: number | null;
  }> {
    const plan = await this.planRepo.findOne({ where: { tenantId } });
    const usage = await this.getCurrentUsage(tenantId);
    const planConfig = plan ? await this.configRepo.findOne({ where: { planType: plan.planType } }) : null;

    let trialDaysRemaining: number | null = null;
    if (plan?.planType === 'trial' && plan.trialEndsAt) {
      trialDaysRemaining = Math.max(0, Math.ceil((plan.trialEndsAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000)));
    }

    const used = usage?.conversationCount ?? 0;
    const limit = plan?.conversationLimit ?? null;

    return {
      plan,
      usage: {
        used,
        limit,
        percentUsed: limit ? Math.round((used / limit) * 100) : null,
      },
      planConfig,
      trialDaysRemaining,
    };
  }

  // ─── Usage tracking ──────────────────────────────────────────────

  async incrementConversationCount(tenantId: string): Promise<void> {
    const now = new Date();
    const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);

    const existing = await this.usageRepo.findOne({
      where: { tenantId, periodStart: periodStart as any },
    });

    if (existing) {
      existing.conversationCount += 1;
      await this.usageRepo.save(existing);
    } else {
      await this.usageRepo.save(
        this.usageRepo.create({
          tenantId,
          periodStart,
          periodEnd,
          conversationCount: 1,
        }),
      );
    }
  }

  async checkConversationLimit(tenantId: string): Promise<{ allowed: boolean; used: number; limit: number | null }> {
    const plan = await this.planRepo.findOne({ where: { tenantId } });
    const limit = plan?.conversationLimit ?? null;
    if (limit === null) return { allowed: true, used: 0, limit: null };

    const usage = await this.getCurrentUsage(tenantId);
    const used = usage?.conversationCount ?? 0;
    // Soft limit: allow up to 150% (never hard-block sales)
    return { allowed: used < limit * 1.5, used, limit };
  }

  private async getCurrentUsage(tenantId: string): Promise<SubscriptionUsage | null> {
    const now = new Date();
    const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
    return this.usageRepo.findOne({
      where: { tenantId, periodStart: periodStart as any },
    });
  }

  // ─── Upgrade flow ────────────────────────────────────────────────

  async createUpgradeSubscription(tenantId: string, planType: string): Promise<{ pageUrl: string }> {
    const planConfig = await this.configRepo.findOne({ where: { planType, isActive: true } });
    if (!planConfig) throw new Error(`Unknown or inactive plan type: ${planType}`);
    const price = planConfig.price;

    const baseUrl = this.config.get<string>('app.baseUrl') ?? 'http://localhost:3000';
    const adminUrl = this.config.get<string>('app.adminUrl') ?? 'http://localhost:5173';

    const result = await this.monoService.createSubscription({
      amount: price,
      interval: '1m',
      redirectUrl: `${adminUrl}/settings?subscription=success`,
      chargeWebhookUrl: `${baseUrl}/subscriptions/webhook/charge`,
      statusWebhookUrl: `${baseUrl}/subscriptions/webhook/status`,
    });

    // Store subscription ID for tracking
    await this.planRepo.update(
      { tenantId },
      {
        monoSubscriptionId: result.subscriptionId,
        amount: price,
      } as any,
    );

    return { pageUrl: result.pageUrl };
  }

  // ─── Webhook handlers ────────────────────────────────────────────

  async handleChargeWebhook(payload: Record<string, unknown>): Promise<void> {
    const subscriptionId = payload.subscriptionId as string;
    const status = payload.status as string;

    const plan = await this.planRepo.findOne({ where: { monoSubscriptionId: subscriptionId } });
    if (!plan) {
      this.logger.warn(`Webhook for unknown subscription: ${subscriptionId}`);
      return;
    }

    if (status === 'success') {
      const now = new Date();
      plan.status = 'active';
      plan.currentPeriodStart = now;
      plan.currentPeriodEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

      // Activate paid plan if still on trial
      if (plan.planType === 'trial') {
        const matchedConfig = await this.configRepo.findOne({ where: { price: plan.amount! } });
        if (matchedConfig) {
          plan.planType = matchedConfig.planType;
          plan.conversationLimit = matchedConfig.conversationLimit;
        } else {
          plan.planType = 'starter';
          plan.conversationLimit = 1000;
        }
      }

      await this.planRepo.save(plan);
      this.invalidateCache(plan.tenantId);
      this.logger.log(`Charge success for tenant ${plan.tenantId}, plan ${plan.planType}`);
    } else if (status === 'failure' || status === 'expired') {
      plan.status = 'past_due';
      await this.planRepo.save(plan);
      this.invalidateCache(plan.tenantId);
      this.logger.warn(`Charge failed for tenant ${plan.tenantId}: ${status}`);
    }
  }

  async handleStatusWebhook(payload: Record<string, unknown>): Promise<void> {
    const subscriptionId = payload.subscriptionId as string;
    const status = payload.status as string;

    const plan = await this.planRepo.findOne({ where: { monoSubscriptionId: subscriptionId } });
    if (!plan) {
      this.logger.warn(`Status webhook for unknown subscription: ${subscriptionId}`);
      return;
    }

    this.logger.log(`Subscription status change: ${subscriptionId} → ${status}`);

    if (status === 'deactivated' || status === 'cancelled') {
      plan.status = 'cancelled';
      await this.planRepo.save(plan);
      this.invalidateCache(plan.tenantId);
    }
  }

  // ─── Cancel ──────────────────────────────────────────────────────

  async cancelPlan(tenantId: string): Promise<void> {
    const plan = await this.planRepo.findOne({ where: { tenantId } });
    if (!plan) return;

    plan.status = 'cancelled';
    await this.planRepo.save(plan);
    this.invalidateCache(tenantId);
    this.logger.log(`Plan cancelled for tenant ${tenantId}, active until ${plan.currentPeriodEnd}`);
  }

  // ─── Trial expiry cron ───────────────────────────────────────────

  @Cron('0 8 * * *')
  async checkTrialExpiry(): Promise<void> {
    const expired = await this.planRepo.find({
      where: { planType: 'trial', status: 'active', trialEndsAt: LessThanOrEqual(new Date()) },
    });

    for (const plan of expired) {
      plan.status = 'expired';
      await this.planRepo.save(plan);
      this.invalidateCache(plan.tenantId);
      this.logger.log(`Trial expired for tenant ${plan.tenantId}`);
    }

    if (expired.length > 0) {
      this.logger.log(`Trial expiry check: ${expired.length} expired`);
    }
  }
}
