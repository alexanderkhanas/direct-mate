import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { EntityManager, Repository, LessThanOrEqual } from 'typeorm';
import { Cron } from '@nestjs/schedule';
import { SubscriptionPlan } from './entities/subscription-plan.entity';
import { SubscriptionUsage } from './entities/subscription-usage.entity';
import { SubscriptionPlanConfig } from './entities/subscription-plan-config.entity';
import { MonoPaymentService } from './mono-payment.service';
import { TelegramService } from '../notifications/telegram.service';

export const TRIAL_DAYS = 14;
export const TRIAL_CONVERSATIONS = 200;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Reminders to the owner's Telegram (the chats that get handoff notifications). */
const TRIAL_TEXT = {
  days: (n: number, url: string) =>
    `⏳ Пробний період DirectMate закінчується ${n === 1 ? 'завтра' : `через ${n} дні`}. ` +
    `Щоб AI-агент і далі відповідав клієнтам, оберіть тариф: ${url}`,
  conv80: (used: number, limit: number, url: string) =>
    `📈 AI-агент уже провів ${used} з ${limit} безкоштовних розмов. Коли вони закінчаться, він перестане відповідати — ` +
    `оберіть тариф заздалегідь: ${url}`,
  conv100: (limit: number, url: string) =>
    `Безкоштовні розмови закінчилися (${limit} з ${limit}). AI-агент більше не відповідає клієнтам — повідомлення чекають ` +
    `на менеджерів. Оберіть тариф, щоб увімкнути його знову: ${url}`,
  expired: (url: string) =>
    'Пробний період закінчився. AI-агент більше не відповідає клієнтам — повідомлення чекають на менеджерів. ' +
    `Оберіть тариф, щоб увімкнути його знову: ${url}`,
};

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
    private readonly telegram: TelegramService,
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

  /** Pass the registration transaction's manager so the trial commits with the store. */
  async createTrialForTenant(tenantId: string, manager?: EntityManager): Promise<SubscriptionPlan> {
    const repo = manager ? manager.getRepository(SubscriptionPlan) : this.planRepo;
    const existing = await repo.findOne({ where: { tenantId } });
    if (existing) return existing;

    // Not started: the clock and the conversation count begin at go-live (startTrial).
    const plan = repo.create({
      tenantId,
      planType: 'trial',
      status: 'active',
      trialEndsAt: null,
      trialStartedAt: null,
      conversationLimit: TRIAL_CONVERSATIONS,
    });
    return repo.save(plan);
  }

  /**
   * The owner turned the bot on: the free trial starts now, for TRIAL_DAYS or
   * TRIAL_CONVERSATIONS conversations, whichever comes first. Does nothing for
   * a trial already running or a paid plan.
   */
  async startTrial(tenantId: string): Promise<void> {
    const plan = await this.planRepo.findOne({ where: { tenantId } });
    if (!plan || plan.planType !== 'trial' || plan.trialStartedAt) return;
    const now = new Date();
    plan.trialStartedAt = now;
    plan.trialEndsAt = new Date(now.getTime() + TRIAL_DAYS * DAY_MS);
    plan.conversationLimit = TRIAL_CONVERSATIONS;
    plan.status = 'active';
    await this.planRepo.save(plan);
    this.invalidateCache(tenantId);
  }

  /**
   * Whether the bot may take on a NEW conversation: a running trial stops at
   * its conversation limit (the conversation that reaches it is the last).
   * Paid plans aren't capped here; the limit is shown, not enforced.
   */
  async hasRoomForConversation(tenantId: string): Promise<boolean> {
    const plan = await this.planRepo.findOne({ where: { tenantId } });
    if (!plan || plan.planType !== 'trial' || !plan.trialStartedAt) return true;
    return (await this.trialConversations(tenantId, plan.trialStartedAt)) < (plan.conversationLimit ?? TRIAL_CONVERSATIONS);
  }

  /**
   * A conversation got its first live reply: count it, and remind or end the
   * trial when it crosses 80% or 100% of its conversations.
   */
  async recordConversation(tenantId: string): Promise<void> {
    await this.incrementConversationCount(tenantId);
    const plan = await this.planRepo.findOne({ where: { tenantId } });
    if (!plan || plan.planType !== 'trial' || !plan.trialStartedAt) return;
    const limit = plan.conversationLimit ?? TRIAL_CONVERSATIONS;
    const used = await this.trialConversations(tenantId, plan.trialStartedAt);
    if (used >= limit) {
      plan.status = 'expired';
      await this.planRepo.save(plan);
      this.invalidateCache(tenantId);
      await this.remindOnce(plan, 'conv_100', TRIAL_TEXT.conv100(limit, this.billingUrl()));
    } else if (used >= limit * 0.8) {
      await this.remindOnce(plan, 'conv_80', TRIAL_TEXT.conv80(used, limit, this.billingUrl()));
    }
  }

  /** Conversations the bot answered live since the trial started (not the owner's test chat). */
  private async trialConversations(tenantId: string, since: Date): Promise<number> {
    const [row]: Array<{ n: number }> = await this.planRepo.manager.query(
      `SELECT count(DISTINCT m.conversation_id)::int AS n
         FROM messages m JOIN conversations c ON c.id = m.conversation_id
        WHERE c.tenant_id = $1 AND c.channel = 'instagram'
          AND m.direction = 'outbound' AND m.role = 'assistant' AND m.created_at >= $2`,
      [tenantId, since],
    );
    return row?.n ?? 0;
  }

  /** Sends to the store's linked Telegram chats, once per reminder. */
  private async remindOnce(plan: SubscriptionPlan, key: string, text: string): Promise<void> {
    if (plan.remindersSent?.includes(key)) return;
    plan.remindersSent = [...(plan.remindersSent ?? []), key];
    await this.planRepo.update(plan.id, { remindersSent: plan.remindersSent });
    await this.telegram.sendToTenant(plan.tenantId, text).catch(() => undefined);
  }

  private billingUrl(): string {
    return `${this.config.get<string>('app.adminUrl') ?? 'http://localhost:5173'}/settings#subscription`;
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
    // A trial waiting for go-live: the bot is paused anyway, and the owner's test chat must work.
    if (plan.planType === 'trial' && !plan.trialStartedAt && plan.status === 'active') {
      this.activePlanCache.set(tenantId, { active: true, expiresAt: Date.now() + 5 * 60 * 1000 });
      return true;
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
    /** Whether the bot may answer customers on this plan right now. */
    active: boolean;
    /** False while a trial waits for go-live. */
    trialStarted: boolean;
  }> {
    const plan = await this.planRepo.findOne({ where: { tenantId } });
    const usage = await this.getCurrentUsage(tenantId);
    const planConfig = plan ? await this.configRepo.findOne({ where: { planType: plan.planType } }) : null;

    let trialDaysRemaining: number | null = null;
    if (plan?.planType === 'trial' && plan.trialEndsAt) {
      trialDaysRemaining = Math.max(0, Math.ceil((plan.trialEndsAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000)));
    }

    // A trial counts its conversations since go-live, not per calendar month.
    const used =
      plan?.planType === 'trial'
        ? plan.trialStartedAt
          ? await this.trialConversations(tenantId, plan.trialStartedAt)
          : 0
        : (usage?.conversationCount ?? 0);
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
      active: await this.isActive(tenantId),
      trialStarted: plan?.planType !== 'trial' || !!plan?.trialStartedAt,
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
      await this.remindOnce(plan, 'expired', TRIAL_TEXT.expired(this.billingUrl()));
      this.logger.log(`Trial expired for tenant ${plan.tenantId}`);
    }

    // Reminders before the end, for trials that started at go-live.
    const running = await this.planRepo.find({ where: { planType: 'trial', status: 'active' } });
    for (const plan of running) {
      if (!plan.trialEndsAt || !plan.trialStartedAt) continue;
      const daysLeft = (plan.trialEndsAt.getTime() - Date.now()) / DAY_MS;
      if (daysLeft <= 1) await this.remindOnce(plan, 'days_1', TRIAL_TEXT.days(1, this.billingUrl()));
      else if (daysLeft <= 3) await this.remindOnce(plan, 'days_3', TRIAL_TEXT.days(3, this.billingUrl()));
    }

    if (expired.length > 0) {
      this.logger.log(`Trial expiry check: ${expired.length} expired`);
    }
  }
}
