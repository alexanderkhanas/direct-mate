import type { OnboardingStatus, OnboardingStepKey } from '../onboarding/onboarding.service';
import { nextStep } from './setup-guide';

const ORDER: OnboardingStepKey[] = ['products', 'instagram', 'knowledge', 'sizes', 'test', 'tone', 'telegram', 'live'];

function status(done: OnboardingStepKey[], extra: Partial<OnboardingStatus> = {}): OnboardingStatus {
  return {
    completed: false,
    operatingMode: 'paused',
    steps: ORDER.map((key) => ({ key, state: done.includes(key) ? 'done' : 'todo', blocking: false })),
    readiness: { ready: false, missing: [] },
    store: { name: 'Alta', businessType: 'fashion', instagram: null, feedUrl: null, products: { total: 0, inStock: 0 } },
    supportAvailable: false,
    ...extra,
  } as OnboardingStatus;
}

describe('nextStep', () => {
  it('starts with the catalog', () => {
    expect(nextStep(status([])).step).toBe('products');
  });

  it('says to carry on while a product import runs, instead of asking for the catalog again', () => {
    const next = nextStep(status([]), { importing: true });
    expect(next.ask_owner).toEqual([]);
    expect(next.then_call).toContain('get_setup_status');
  });

  it('asks only about the note sections still empty', () => {
    const next = nextStep(status(['products', 'instagram']), { missingSections: ['returns'] });
    expect(next.step).toBe('knowledge');
    expect(next.ask_owner).toHaveLength(1);
    expect(next.ask_owner[0]).toContain('Returns');
  });

  it('proposes learning mode first and the owner’s yes before going live', () => {
    const next = nextStep(status(ORDER.filter((k) => k !== 'live')));
    expect(next.step).toBe('live');
    expect(next.ask_owner[0]).toContain('learning mode');
    expect(next.then_call).toContain('confirmed: true only after');
  });

  it('treats a skipped step as dealt with', () => {
    const s = status(['products', 'instagram', 'knowledge', 'sizes', 'test']);
    s.steps.find((x) => x.key === 'tone')!.state = 'skipped';
    expect(nextStep(s).step).toBe('telegram');
  });

  it('is done once the agent is on', () => {
    expect(nextStep(status(ORDER, { operatingMode: 'active' })).step).toBe('done');
  });
});
