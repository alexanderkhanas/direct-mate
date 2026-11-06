import { buildAgentTools, serialQueue } from './index';
import type { AgentStoreSettings } from '../store-settings.service';

describe('buildAgentTools', () => {
  const scope = { tenantId: 't1', conversationId: 'c1', customerId: 'u1' };
  const settings = (advice: 'recommend' | 'consult') =>
    ({ sizing: { advice, askMeasurementsFirst: false }, checkoutFields: [] }) as unknown as AgentStoreSettings;

  it('leaves out the size tool when the store wants sizes from a manager', () => {
    expect(Object.keys(buildAgentTools({} as never, scope, settings('recommend')))).toContain('get_size_help');
    expect(Object.keys(buildAgentTools({} as never, scope, settings('consult')))).not.toContain('get_size_help');
  });
});

describe('serialQueue', () => {
  it('runs calls one after another in call order, even when an earlier one is slower', async () => {
    const serial = serialQueue();
    const events: string[] = [];
    const slowWrite = serial(async () => {
      events.push('write:start');
      await new Promise((r) => setTimeout(r, 20));
      events.push('write:end');
    });
    const read = serial(async () => {
      events.push('read');
    });
    await Promise.all([slowWrite, read]);
    expect(events).toEqual(['write:start', 'write:end', 'read']);
  });

  it('keeps going after a call fails', async () => {
    const serial = serialQueue();
    await expect(serial(async () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    await expect(serial(async () => 'next')).resolves.toBe('next');
  });
});
