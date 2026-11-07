import { SettingsService } from './settings.service';

function setup() {
  const examples = {
    create: jest.fn((row) => row),
    save: jest.fn(async (row) => ({ id: 'ex-1', ...row })),
    update: jest.fn(async () => ({ affected: 1 })),
    find: jest.fn(async () => []),
  };
  const service = new SettingsService({} as never, examples as never);
  return { service, examples };
}

describe('SettingsService manager examples', () => {
  it("saves an example under the caller's store, whatever the body says", async () => {
    const { service, examples } = setup();
    await service.createExample('tenant-a', {
      customerMessage: 'Є в M?',
      managerReply: 'Так, є',
      tenantId: 'tenant-b',
    } as never);
    expect(examples.create).toHaveBeenCalledWith({
      tenantId: 'tenant-a',
      customerMessage: 'Є в M?',
      managerReply: 'Так, є',
      scenario: null,
      tags: [],
    });
  });

  it("only removes the caller's own example", async () => {
    const { service, examples } = setup();
    await service.deleteExample('tenant-a', 'ex-9');
    expect(examples.update).toHaveBeenCalledWith({ id: 'ex-9', tenantId: 'tenant-a' }, { isActive: false });
  });
});
