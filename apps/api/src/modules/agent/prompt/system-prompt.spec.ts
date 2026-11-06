import { buildSystemPrompt } from './system-prompt';
import { parseSizing, type AgentStoreSettings } from '../store-settings.service';

const SETTINGS: AgentStoreSettings = {
  tenantName: 'Alta Men',
  timezone: 'Europe/Kyiv',
  knowledgeDoc: 'Відправка 1–3 дні.',
  brandTone: null,
  managerExamples: [],
  businessHours: [],
  welcomeLine: null,
  disallowedPhrases: [],
  checkoutFields: ['fullName', 'phone'],
  paymentDetails: null,
  handoffAnnounce: null,
  sizeChart: null,
  sizing: { advice: 'recommend', askMeasurementsFirst: false },
  conversationIdleHours: 24,
  modelOverride: null,
  operatingMode: 'active',
};

const sizes = (settings: AgentStoreSettings) => {
  const prompt = buildSystemPrompt(settings, '(catalog)');
  return prompt.slice(prompt.indexOf('## Sizes'), prompt.indexOf('## Details needed'));
};

describe('parseSizing', () => {
  it('defaults to recommending, without asking measurements first', () => {
    expect(parseSizing(undefined)).toEqual({ advice: 'recommend', askMeasurementsFirst: false });
  });

  it('keeps valid values and drops a malformed one', () => {
    expect(parseSizing({ advice: 'consult', askMeasurementsFirst: true })).toEqual({
      advice: 'consult',
      askMeasurementsFirst: true,
    });
    expect(parseSizing({ advice: 'guess', askMeasurementsFirst: 'yes' })).toEqual({
      advice: 'recommend',
      askMeasurementsFirst: false,
    });
  });
});

describe('the Sizes section', () => {
  it('recommends a size and offers a manager check, without handing off by itself', () => {
    const section = sizes(SETTINGS);
    expect(section).toContain('get_size_help');
    expect(section).toContain('100%');
    expect(section).toContain('Hand off only when they say yes');
    expect(section).not.toContain('height and weight, unless');
  });

  it('collects measurements and hands off when sizes need a manager', () => {
    const section = sizes({ ...SETTINGS, sizing: { advice: 'consult', askMeasurementsFirst: false } });
    expect(section).toContain("don't name a size yourself");
    expect(section).not.toContain('get_size_help');
  });

  it('asks measurements first when the store wants that', () => {
    expect(sizes({ ...SETTINGS, sizing: { advice: 'recommend', askMeasurementsFirst: true } })).toContain(
      "Before suggesting clothes, ask the customer's height and weight",
    );
  });
});
