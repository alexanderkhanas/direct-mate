import { SubscriptionsService, TRIAL_CONVERSATIONS, TRIAL_DAYS } from './subscriptions.service';

type Plan = Record<string, any>;

function setup(plan: Plan | null, opts: { trialConversations?: number } = {}) {
  const planRepo = {
    findOne: jest.fn(async () => plan),
    // `trialEndsAt` in the query is LessThanOrEqual(now): the expiry sweep.
    find: jest.fn(async ({ where }: { where: Record<string, unknown> }) =>
      plan &&
      plan.planType === where.planType &&
      plan.status === where.status &&
      (!('trialEndsAt' in where) || (plan.trialEndsAt && plan.trialEndsAt <= new Date()))
        ? [plan]
        : [],
    ),
    save: jest.fn(async (p: Plan) => p),
    update: jest.fn(async (_id: string, patch: Plan) => Object.assign(plan ?? {}, patch)),
    manager: { query: jest.fn(async () => [{ n: opts.trialConversations ?? 0 }]) },
  };
  const usageRepo = { findOne: jest.fn(async () => null), save: jest.fn(), create: jest.fn((r) => r) };
  const telegram = { sendToTenant: jest.fn(async () => undefined) };
  const config = { get: jest.fn(() => 'https://app.directmate.app') };
  const service = new SubscriptionsService(
    planRepo as never,
    usageRepo as never,
    {} as never,
    {} as never,
    config as never,
    telegram as never,
  );
  return { service, planRepo, telegram };
}

const trial = (over: Plan = {}): Plan => ({
  id: 'p1',
  tenantId: 't1',
  planType: 'trial',
  status: 'active',
  trialStartedAt: null,
  trialEndsAt: null,
  conversationLimit: TRIAL_CONVERSATIONS,
  remindersSent: [],
  ...over,
});

describe('SubscriptionsService — trial from go-live', () => {
  it('counts a trial that has not started as active, so setup and the test chat work', async () => {
    expect(await setup(trial()).service.isActive('t1')).toBe(true);
  });

  it('starts the trial at go-live: 14 days and 200 conversations from now', async () => {
    const plan = trial();
    await setup(plan).service.startTrial('t1');
    expect(plan.trialStartedAt).toBeInstanceOf(Date);
    const days = (plan.trialEndsAt.getTime() - plan.trialStartedAt.getTime()) / 86_400_000;
    expect(days).toBe(TRIAL_DAYS);
    expect(plan.conversationLimit).toBe(200);
  });

  it('never restarts a running trial or touches a paid plan', async () => {
    const started = new Date('2026-11-01T10:00:00Z');
    const running = trial({ trialStartedAt: started });
    await setup(running).service.startTrial('t1');
    expect(running.trialStartedAt).toBe(started);

    const paid = { ...trial(), planType: 'starter' };
    const t = setup(paid);
    await t.service.startTrial('t1');
    expect(t.planRepo.save).not.toHaveBeenCalled();
  });

  it('stops taking new conversations at the limit, and lets paid plans through', async () => {
    const running = trial({ trialStartedAt: new Date(), trialEndsAt: new Date(Date.now() + 86_400_000) });
    expect(await setup(running, { trialConversations: 199 }).service.hasRoomForConversation('t1')).toBe(true);
    expect(await setup(running, { trialConversations: 200 }).service.hasRoomForConversation('t1')).toBe(false);
    expect(await setup({ ...running, planType: 'starter' }, { trialConversations: 5000 }).service.hasRoomForConversation('t1')).toBe(true);
  });

  it('reminds at 80% once, and ends the trial at 100%', async () => {
    const running = trial({ trialStartedAt: new Date(), trialEndsAt: new Date(Date.now() + 86_400_000) });
    const at80 = setup(running, { trialConversations: 160 });
    await at80.service.recordConversation('t1');
    await at80.service.recordConversation('t1');
    expect(at80.telegram.sendToTenant).toHaveBeenCalledTimes(1);
    expect(at80.telegram.sendToTenant).toHaveBeenCalledWith('t1', expect.stringContaining('160 з 200'));

    const full = setup(trial({ trialStartedAt: new Date(), trialEndsAt: new Date(Date.now() + 86_400_000) }), { trialConversations: 200 });
    await full.service.recordConversation('t1');
    expect(full.planRepo.save).toHaveBeenCalledWith(expect.objectContaining({ status: 'expired' }));
    expect(full.telegram.sendToTenant).toHaveBeenCalledWith('t1', expect.stringContaining('Безкоштовні розмови закінчилися'));
  });

  it('expires a trial at its end date and sends the reminders before it once each', async () => {
    const ended = trial({ trialStartedAt: new Date(Date.now() - 15 * 86_400_000), trialEndsAt: new Date(Date.now() - 1000) });
    const t = setup(ended);
    await t.service.checkTrialExpiry();
    expect(ended.status).toBe('expired');
    expect(t.telegram.sendToTenant).toHaveBeenCalledWith('t1', expect.stringContaining('Пробний період закінчився'));

    const twoDaysLeft = trial({ trialStartedAt: new Date(), trialEndsAt: new Date(Date.now() + 2 * 86_400_000) });
    const soon = setup(twoDaysLeft);
    await soon.service.checkTrialExpiry();
    await soon.service.checkTrialExpiry();
    expect(soon.telegram.sendToTenant).toHaveBeenCalledTimes(1);
    expect(soon.telegram.sendToTenant).toHaveBeenCalledWith('t1', expect.stringContaining('через 3 дні'));
  });
});
