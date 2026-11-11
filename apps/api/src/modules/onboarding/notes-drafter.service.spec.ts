import { MockLanguageModelV4 } from 'ai/test';
import { NotesDrafterService } from './notes-drafter.service';
import { readWebsite, pageText, policyLinks } from './website-reader';
import { renderKnowledgeDoc, emptyDraft } from './store-notes';

jest.mock('./website-reader', () => {
  const actual = jest.requireActual('./website-reader');
  return { ...actual, readWebsite: jest.fn() };
});
const readWebsiteMock = readWebsite as jest.MockedFunction<typeof readWebsite>;

const USAGE = {
  inputTokens: { total: 100, noCache: 100, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 10, text: 10, reasoning: 0 },
};
const text = (t: string) => ({
  content: [{ type: 'text' as const, text: t }],
  finishReason: { unified: 'stop' as const, raw: undefined },
  usage: USAGE,
  warnings: [],
});
const call = (toolName: string, input: unknown) => ({
  content: [{ type: 'tool-call' as const, toolCallId: toolName, toolName, input: JSON.stringify(input) }],
  finishReason: { unified: 'tool-calls' as const, raw: undefined },
  usage: USAGE,
  warnings: [],
});

function setup(model: MockLanguageModelV4, stored: Record<string, unknown> = {}) {
  const writes: Array<{ sql: string; params: unknown[] }> = [];
  const query = jest.fn(async (sql: string, params: unknown[]) => {
    if (sql.includes('FROM tenants WHERE id')) return [{ name: 'Alta', business_type: 'fashion' }];
    if (sql.includes("history_import->'facts'")) return [{ facts: stored.facts ?? null }];
    if (sql.includes('SELECT o.notes_draft')) return [{ notes_draft: stored.draft ?? null, interview: stored.interview ?? null, feed_url: null }];
    writes.push({ sql, params });
    return [];
  });
  const models = { resolve: () => ({ model, providerOptions: {} }) };
  return { service: new NotesDrafterService({ query } as never, models as never), writes };
}

describe('NotesDrafterService', () => {
  beforeEach(() => readWebsiteMock.mockReset());

  it("drafts the notes from the store's website and opens the chat with what's missing", async () => {
    readWebsiteMock.mockResolvedValue([{ url: 'https://alta.example/dostavka', text: 'Відправляємо Новою Поштою за 1-2 дні.' }]);
    const model = new MockLanguageModelV4({
      doGenerate: [
        text(
          JSON.stringify({
            delivery: '- Нова Пошта, відправка за 1–2 дні.',
            payment: null,
            returns: null,
            sizes: null,
            contacts: null,
            other: null,
            paymentDetails: null,
            checkoutFields: ['fullName', 'phone', 'city', 'novaPoshtaBranch'],
            businessHours: null,
            sizingAdvice: 'recommend',
            questions: ['Як можна оплатити замовлення?', 'Хто оплачує доставку?'],
          }),
        ),
      ],
    });
    const t = setup(model);
    const { draft, messages } = await t.service.draft('t1', { websiteUrl: 'https://alta.example' });

    expect(draft.sections).toEqual({ delivery: '- Нова Пошта, відправка за 1–2 дні.' });
    expect(draft.sources).toEqual(['https://alta.example/dostavka']);
    expect(messages[0].text).toContain('з вашого сайту: доставка');
    // Neutral: the assistant has no gender (no «склала» / «склав»).
    expect(messages[0].text).not.toMatch(/склала|склав/);
    expect(messages[0].text).toContain('Як можна оплатити замовлення?');
    // The model saw the page text.
    expect(JSON.stringify(model.doGenerateCalls[0].prompt)).toContain('Відправляємо Новою Поштою');
  });

  it('asks the standard questions without a model call when there is no website', async () => {
    const model = new MockLanguageModelV4({ doGenerate: [] });
    const { draft, messages } = await setup(model).service.draft('t1', {});
    expect(model.doGenerateCalls).toHaveLength(0);
    expect(draft.questions.length).toBeGreaterThan(0);
    expect(messages[0].text).toContain('Якою службою відправляєте');
  });

  it("tells the owner when their website couldn't be read, then asks the standard questions", async () => {
    readWebsiteMock.mockResolvedValue([]);
    const model = new MockLanguageModelV4({ doGenerate: [] });
    const { messages } = await setup(model).service.draft('t1', { websiteUrl: 'https://down.example' });
    expect(model.doGenerateCalls).toHaveLength(0);
    expect(messages[0].text).toContain('Не вдалося відкрити ваш сайт');
  });

  it('drafts from text the owner pasted, without reading any website', async () => {
    const model = new MockLanguageModelV4({
      doGenerate: [
        text(
          JSON.stringify({
            delivery: '- Нова Пошта, відправка щодня до 16:00.',
            payment: '- Накладений платіж або передоплата на картку ФОП.',
            returns: null,
            sizes: null,
            contacts: null,
            other: null,
            paymentDetails: null,
            checkoutFields: ['fullName', 'phone', 'city', 'novaPoshtaBranch'],
            businessHours: null,
            sizingAdvice: null,
            questions: ['Чи можна обміняти товар?'],
          }),
        ),
      ],
    });
    const { draft, messages } = await setup(model).service.draft('t1', { text: 'Відправляємо Новою Поштою щодня до 16:00.' });

    expect(readWebsiteMock).not.toHaveBeenCalled();
    expect(JSON.stringify(model.doGenerateCalls[0].prompt)).toContain('Text the shop already sends customers');
    expect(draft.sections.payment).toContain('Накладений платіж');
    expect(messages[0].text).toContain('з вашого тексту: доставка, оплата');
  });

  it("records the owner's answers in the draft with its tools", async () => {
    const model = new MockLanguageModelV4({
      doGenerate: [
        call('update_section', { section: 'payment', text: '- Накладений платіж\n- Передоплата на картку' }),
        call('set_payment_details', { details: 'ФОП Іваненко, IBAN UA12 3456' }),
        text('Записала. А протягом скількох днів можна обміняти товар?'),
      ],
    });
    const t = setup(model, { draft: { ...emptyDraft(), questions: ['Як оплатити?'] } });
    const result = await t.service.chat('t1', 'Накладений платіж або передоплата, реквізити: ФОП Іваненко, IBAN UA12 3456');

    expect(result.reply).toContain('обміняти');
    expect(result.draft.sections.payment).toContain('Передоплата на картку');
    expect(result.draft.paymentDetails).toBe('ФОП Іваненко, IBAN UA12 3456');
    expect(result.messages.map((m) => m.role)).toEqual(['owner', 'assistant']);
  });

  it('tells the interview which key sections are still empty, so it asks before finishing', async () => {
    const model = new MockLanguageModelV4({ doGenerate: [text('Як клієнтам з вами зв\'язатися?')] });
    const draft = { ...emptyDraft(), sections: { delivery: '- Нова Пошта', payment: '- Накладений платіж', returns: '- 14 днів' } };
    await setup(model, { draft }).service.chat('t1', 'Все, начебто');
    const instructions = JSON.stringify(model.doGenerateCalls[0].prompt);
    expect(instructions).toMatch(/Sections still empty\\n- Контакти\\n\\n/);
  });

  it('drafts from the Instagram history facts alone and says so, grouped by section with counts', async () => {
    const model = new MockLanguageModelV4({
      doGenerate: [
        text(
          JSON.stringify({
            delivery: '- Нова Пошта, відправка за 1–2 дні.',
            payment: '- Накладений платіж або передоплата на картку.',
            returns: null,
            sizes: null,
            contacts: null,
            other: null,
            paymentDetails: null,
            checkoutFields: ['fullName', 'phone', 'city', 'novaPoshtaBranch'],
            businessHours: [{ day: 'mon', hours: '10:00-19:00' }],
            sizingAdvice: 'recommend',
            questions: ['Чи можна обміняти товар?'],
          }),
        ),
      ],
    });
    const facts = [
      { section: 'payment', text: 'Накладений платіж або передоплата на картку', count: 2 },
      { section: 'delivery', text: 'Відправляємо Новою Поштою за 1–2 дні', count: 7 },
      { section: 'hours', text: 'Відповідаємо з 10:00 до 19:00', count: 3 },
      'старий формат, рядок без розділу',
    ];
    const { draft, messages } = await setup(model, { facts }).service.draft('t1', {});

    expect(readWebsiteMock).not.toHaveBeenCalled();
    const prompt = JSON.stringify(model.doGenerateCalls[0].prompt);
    expect(prompt).toContain('### Delivery\\n- Відправляємо Новою Поштою за 1–2 дні (7 conversations)');
    expect(prompt).toContain('### Working hours\\n- Відповідаємо з 10:00 до 19:00 (3 conversations)');
    expect(prompt).not.toContain('старий формат');
    expect(draft.businessHours).toEqual({ mon: '10:00-19:00' });
    expect(messages[0].text).toMatch(/^Чернетку складено з того, що AI-агент дізнався з вашого Instagram: доставка, оплата, години роботи\. Перевірте її\./);
    expect(messages[0].text).not.toMatch(/склала|склав/);
    expect(messages[0].text).toContain('Чи можна обміняти товар?');
  });

  it('keeps the website as the source when there are history facts too', async () => {
    readWebsiteMock.mockResolvedValue([{ url: 'https://alta.example/dostavka', text: 'Нова Пошта.' }]);
    const model = new MockLanguageModelV4({
      doGenerate: [
        text(
          JSON.stringify({
            delivery: '- Нова Пошта.',
            payment: null,
            returns: null,
            sizes: null,
            contacts: null,
            other: null,
            paymentDetails: null,
            checkoutFields: [],
            businessHours: null,
            sizingAdvice: null,
            questions: [],
          }),
        ),
      ],
    });
    const facts = [{ section: 'delivery', text: 'Нова Пошта', count: 1 }];
    const { messages } = await setup(model, { facts }).service.draft('t1', { websiteUrl: 'https://alta.example' });
    expect(JSON.stringify(model.doGenerateCalls[0].prompt)).toContain('Нова Пошта (one conversation)');
    expect(messages[0].text).toContain('з вашого сайту: доставка');
  });

  it('writes the notes, checkout details and payment details into the store on save', async () => {
    const t = setup(new MockLanguageModelV4({ doGenerate: [] }));
    const draft = {
      ...emptyDraft(),
      sections: { delivery: '- Нова Пошта', payment: '- Накладений платіж' },
      paymentDetails: 'IBAN UA00',
      businessHours: { mon: '09:00-18:00', sun: 'closed' },
    };
    await t.service.apply('t1', draft);
    const config = t.writes.find((w) => w.sql.includes('UPDATE store_configs'))!;
    expect(config.params[1]).toBe('# Доставка\n- Нова Пошта\n\n# Оплата\n- Накладений платіж');
    expect(config.params[3]).toBe('IBAN UA00');
    const hours = t.writes.find((w) => w.sql.includes('business_hours'))!;
    expect(JSON.parse(hours.params[1] as string)).toEqual({ mon: '09:00-18:00', sun: 'closed' });
  });
});

describe('website reader', () => {
  const html = `<html><head><script>var x</script><style>.a{}</style></head><body>
    <nav><a href="/catalog">Каталог</a></nav>
    <a href="/oplata-i-dostavka">Оплата і доставка</a>
    <a href="https://alta.example/contacts">Контакти</a>
    <a href="/obmin">Обмін та повернення</a>
    <a href="https://other.example/dostavka">чужий сайт</a>
    <p>Сорочки з льону&nbsp;для чоловіків</p>
    <footer>Тел. +380 67 000 00 00</footer></body></html>`;

  it("finds the shop's own policy pages, delivery and payment first", () => {
    expect(policyLinks(html, 'https://alta.example/')).toEqual([
      'https://alta.example/oplata-i-dostavka',
      'https://alta.example/contacts',
      'https://alta.example/obmin',
    ]);
  });

  it('keeps visible text and the footer, drops scripts and navigation', () => {
    const text = pageText(html);
    expect(text).toContain('Сорочки з льону для чоловіків');
    expect(text).toContain('+380 67 000 00 00');
    expect(text).not.toContain('var x');
    expect(text).not.toContain('Каталог');
  });

  it('renders the notes the agent reads, skipping empty sections', () => {
    expect(renderKnowledgeDoc({ ...emptyDraft(), sections: { returns: '- 14 днів' } })).toBe('# Обмін і повернення\n- 14 днів');
  });
});
