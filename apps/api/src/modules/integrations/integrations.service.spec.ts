import { IntegrationsService, withoutTokens } from './integrations.service';

describe('IntegrationsService', () => {
  const connection = {
    id: 'c1',
    tenantId: 't1',
    type: 'shopify',
    accessTokenEncrypted: 'enc:access',
    refreshTokenEncrypted: 'enc:refresh',
    metadata: { shopDomain: 'lliana.myshopify.com' },
  };

  it('lists connections for the admin without their tokens, even encrypted', async () => {
    const repo = { find: jest.fn(async () => [connection]) };
    const service = new IntegrationsService(repo as never, {} as never, {} as never, {} as never, {} as never);
    const [listed] = await service.findAll('t1');
    expect(listed).toEqual({ id: 'c1', tenantId: 't1', type: 'shopify', metadata: { shopDomain: 'lliana.myshopify.com' } });
    expect(repo.find).toHaveBeenCalledWith({ where: { tenantId: 't1' } });
  });

  it('strips both tokens from a single connection', () => {
    expect(withoutTokens(connection as never)).not.toHaveProperty('accessTokenEncrypted');
    expect(withoutTokens(connection as never)).not.toHaveProperty('refreshTokenEncrypted');
  });
});
