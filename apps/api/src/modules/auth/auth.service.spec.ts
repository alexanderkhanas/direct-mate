import { AuthService } from './auth.service';
import { StoreConfig } from '../engine/entities/store-config.entity';
import { DEFAULT_BRAND_TONE } from '../onboarding/store-defaults';

describe('AuthService.register', () => {
  it('creates a paused store with a welcome line and its trial in the same transaction', async () => {
    const saved: Array<{ entity: unknown; row: Record<string, unknown> }> = [];
    const manager = {
      findOne: jest.fn(async () => null),
      query: jest.fn(async () => []),
      create: jest.fn((entity, row) => ({ entity, row })),
      save: jest.fn(async ({ entity, row }) => {
        saved.push({ entity, row });
        return { id: `${saved.length}`, ...row };
      }),
    };
    const dataSource = { transaction: jest.fn(async (cb) => cb(manager)) };
    const subscriptions = { createTrialForTenant: jest.fn(async () => ({})) };
    const telegram = { notifyPlatform: jest.fn(async () => undefined) };
    const service = new AuthService(
      { findOne: jest.fn(async () => null) } as never,
      { sign: jest.fn(() => 'token') } as never,
      dataSource as never,
      subscriptions as never,
      telegram as never,
    );

    const result = await service.register({
      storeName: 'Alta Men',
      businessType: 'fashion',
      email: 'owner@alta.ua',
      password: 'secret123',
    });

    expect(result.accessToken).toBe('token');
    const storeConfig = saved.find((s) => s.entity === StoreConfig)!.row;
    expect(storeConfig).toMatchObject({
      operatingMode: 'paused',
      brandConfig: { welcomeLine: 'Вітаю! З вами AI-асистент магазину «Alta Men».' },
    });
    expect(saved.some((s) => s.row.brandTonePrompt === DEFAULT_BRAND_TONE)).toBe(true);
    // The trial is created with the transaction's manager, so it commits with the store.
    expect(subscriptions.createTrialForTenant).toHaveBeenCalledWith('1', manager);
    expect(manager.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO tenant_onboarding'), ['1']);
    expect(telegram.notifyPlatform).toHaveBeenCalledWith(expect.stringContaining('Alta Men'));
  });
});
