import { DirectPermissionsService } from './direct-permissions.service';

function setup(opts: { pausedRows?: number } = {}) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const dataSource = {
    query: jest.fn(async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      if (sql.includes('UPDATE store_configs')) {
        const rows = Array.from({ length: opts.pausedRows ?? 0 }, () => ({ tenant_id: 't1' }));
        return [rows, rows.length];
      }
      if (sql.includes('FROM tenants t')) {
        return [{ read_at: new Date('2026-11-20T10:00:00Z'), reply_at: null, read_decided: true, reply_decided: false }];
      }
      return [];
    }),
  };
  const history = { setConsent: jest.fn(async () => undefined), request: jest.fn(async () => undefined) };
  const svc = new DirectPermissionsService(dataSource as never, history as never);
  return { svc, calls, history };
}

describe('DirectPermissionsService', () => {
  it('reads both permissions, when each was given, and whether the owner has answered', async () => {
    const { svc } = setup();
    expect(await svc.get('t1')).toEqual({
      read_messages: { allowed: true, since: '2026-11-20T10:00:00.000Z', decided: true },
      reply_to_customers: { allowed: false, since: null, decided: false },
    });
  });

  it('grants one permission without touching the other, keeping the time of the first grant, and logs who gave it', async () => {
    const { svc, calls } = setup();
    await svc.set('t1', 'reply_to_customers', true, { source: 'claude', userId: 'u1' });
    const write = calls.find((c) => c.sql.includes('INSERT INTO tenant_settings'))!;
    expect(write.sql).toContain('direct_reply_allowed_at');
    expect(write.sql).not.toContain('direct_read_allowed_at');
    expect(write.sql).toContain('coalesce(tenant_settings.direct_reply_allowed_at, now())');
    const log = calls.find((c) => c.sql.includes('INSERT INTO direct_permission_events'))!;
    expect(log.params).toEqual(['t1', 'reply_to_customers', true, 'claude', 'u1']);
  });

  it('records a «no» too, so Claude asks once', async () => {
    const { svc, calls } = setup();
    await svc.set('t1', 'read_messages', false, { source: 'admin' });
    const log = calls.find((c) => c.sql.includes('INSERT INTO direct_permission_events'))!;
    expect(log.params).toEqual(['t1', 'read_messages', false, 'admin', null]);
  });

  it('starts the history import when reading is allowed, and stops it and deletes what it learned when withdrawn', async () => {
    const { svc, history } = setup();
    await svc.set('t1', 'read_messages', true, { source: 'admin' });
    expect(history.setConsent).toHaveBeenLastCalledWith('t1', true);
    expect(history.request).toHaveBeenCalledWith('t1');

    await svc.set('t1', 'read_messages', false, { source: 'admin' });
    expect(history.setConsent).toHaveBeenLastCalledWith('t1', false);
    expect(history.request).toHaveBeenCalledTimes(1);
  });

  it('leaves the history import alone when only replying changes', async () => {
    const { svc, history } = setup();
    await svc.set('t1', 'reply_to_customers', true, { source: 'admin' });
    expect(history.setConsent).not.toHaveBeenCalled();
  });

  it('pauses an active store when replying is withdrawn', async () => {
    const { svc, calls } = setup({ pausedRows: 1 });
    const result = await svc.set('t1', 'reply_to_customers', false, { source: 'admin' });
    expect(result.operatingMode).toBe('paused');
    const pause = calls.find((c) => c.sql.includes('UPDATE store_configs'))!;
    expect(pause.params).toEqual(['t1', 'active']);
  });

  it('pauses a store in learning mode when reading is withdrawn', async () => {
    const { svc, calls } = setup({ pausedRows: 1 });
    await svc.set('t1', 'read_messages', false, { source: 'claude' });
    expect(calls.find((c) => c.sql.includes('UPDATE store_configs'))!.params).toEqual(['t1', 'learning']);
  });

  it('changes no mode when the store wasn’t using the withdrawn permission', async () => {
    const { svc } = setup({ pausedRows: 0 });
    const result = await svc.set('t1', 'reply_to_customers', false, { source: 'admin' });
    expect(result.operatingMode).toBeUndefined();
  });
});
