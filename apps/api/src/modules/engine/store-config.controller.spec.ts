import { BadRequestException } from '@nestjs/common';
import { StoreConfigController } from './store-config.controller';
import type { JwtPayload } from '../../common/decorators/current-user.decorator';

const OWNER: JwtPayload = { sub: 'u1', email: 'o@shop.ua', role: 'owner', tenantId: 't1' };
const SUPERADMIN: JwtPayload = { ...OWNER, role: 'superadmin' };

function setup(mode: string, missing: string[] = []) {
  const config = { tenantId: 't1', operatingMode: mode, learningStartedAt: null };
  const repo = {
    findOne: jest.fn(async () => config),
    create: jest.fn((row) => row),
    save: jest.fn(async (row) => row),
    manager: { query: jest.fn(async () => [{ name: 'Alta', slug: 'alta' }]) },
  };
  const readiness = { check: jest.fn(async () => ({ ready: missing.length === 0, missing })) };
  const telegram = { notifyPlatform: jest.fn(async () => undefined) };
  const controller = new StoreConfigController(repo as never, readiness as never, telegram as never);
  return { controller, repo, readiness, telegram };
}

describe('StoreConfigController go-live', () => {
  it("refuses to turn on a store that isn't ready, and says what's missing", async () => {
    const { controller, repo } = setup('paused', ['products', 'knowledge']);
    const err = await controller.updateConfig(OWNER, { operatingMode: 'active' }).catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.getResponse()).toMatchObject({ missing: ['products', 'knowledge'] });
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('turns on a ready store and tells the founder', async () => {
    const { controller, telegram } = setup('paused');
    const saved = await controller.updateConfig(OWNER, { operatingMode: 'active' });
    expect(saved.operatingMode).toBe('active');
    await new Promise((r) => setImmediate(r));
    expect(telegram.notifyPlatform).toHaveBeenCalledWith(expect.stringContaining('Alta'));
  });

  it('lets a superadmin turn on any store', async () => {
    const { controller, readiness } = setup('paused', ['instagram']);
    await expect(controller.updateConfig(SUPERADMIN, { operatingMode: 'active' })).resolves.toMatchObject({
      operatingMode: 'active',
    });
    expect(readiness.check).not.toHaveBeenCalled();
  });

  it('allows learning and pausing without the checks, and rejects unknown modes', async () => {
    const { controller, readiness } = setup('paused', ['instagram']);
    await controller.updateConfig(OWNER, { operatingMode: 'learning' });
    await controller.updateConfig(OWNER, { operatingMode: 'paused' });
    expect(readiness.check).not.toHaveBeenCalled();
    await expect(controller.updateConfig(OWNER, { operatingMode: 'live' as never })).rejects.toThrow(BadRequestException);
  });
});
