import { NotesDrafterService } from './notes-drafter.service';
import { emptyDraft, parseKnowledgeDoc, renderKnowledgeDoc, type NotesDraft } from './store-notes';

function setup(stored: { draft?: NotesDraft | null; doc?: string | null; checkout?: Record<string, unknown> | null }) {
  const writes: Array<{ sql: string; params: unknown[] }> = [];
  const query = jest.fn(async (sql: string, params: unknown[]) => {
    if (sql.includes('SELECT o.notes_draft')) return [{ notes_draft: stored.draft ?? null, interview: null, feed_url: null }];
    if (sql.includes('SELECT knowledge_doc, checkout_config')) {
      return [{ knowledge_doc: stored.doc ?? null, checkout_config: stored.checkout ?? null }];
    }
    writes.push({ sql, params });
    return [];
  });
  const service = new NotesDrafterService({ query } as never, {} as never);
  /** What `apply` wrote: [tenantId, knowledgeDoc, checkout json, paymentDetails, sizingAdvice]. */
  const applied = () => writes.find((w) => w.sql.includes('UPDATE store_configs'))!.params;
  return { service, writes, applied };
}

describe('parseKnowledgeDoc', () => {
  it('reads back what renderKnowledgeDoc wrote', () => {
    const draft = { ...emptyDraft(), sections: { delivery: '- Нова пошта, 1–2 дні', returns: '- 14 днів' } };
    expect(parseKnowledgeDoc(renderKnowledgeDoc(draft))).toEqual(draft.sections);
  });

  it('keeps text under a heading it does not know, and text before any heading, under other', () => {
    const sections = parseKnowledgeDoc('Ми з Києва.\n\n# Доставка\n- Нова пошта\n\n# Подарункове пакування\n- 50 грн');
    expect(sections.delivery).toBe('- Нова пошта');
    expect(sections.other).toBe('Ми з Києва.\n\n# Подарункове пакування\n- 50 грн');
  });

  it('gives nothing for an empty doc', () => {
    expect(parseKnowledgeDoc(null)).toEqual({});
  });
});

describe('NotesDrafterService.mergeAndApply', () => {
  it('changes one section and keeps the others', async () => {
    const draft = { ...emptyDraft(), sections: { delivery: '- Нова пошта', payment: '- Передоплата' } };
    const { service, applied } = setup({ draft, doc: renderKnowledgeDoc(draft) });
    await service.mergeAndApply('t1', { sections: { returns: '- 14 днів' } });
    expect(applied()[1]).toBe('# Доставка\n- Нова пошта\n\n# Оплата\n- Передоплата\n\n# Обмін і повернення\n- 14 днів');
  });

  it('keeps what was edited in Settings after the draft was saved', async () => {
    const draft = { ...emptyDraft(), sections: { delivery: '- Нова пошта' } };
    const { service, applied } = setup({ draft, doc: '# Доставка\n- Нова пошта і Укрпошта\n\n# Гарантія\n- 6 місяців' });
    await service.mergeAndApply('t1', { sections: { payment: '- Післяплата' } });
    const doc = applied()[1] as string;
    expect(doc).toContain('- Нова пошта і Укрпошта');
    expect(doc).toContain('# Гарантія\n- 6 місяців');
    expect(doc).toContain('# Оплата\n- Післяплата');
  });

  it('does not truncate a long section it was not asked to change', async () => {
    const long = '- ' + 'дуже довгий рядок '.repeat(300);
    const { service, applied } = setup({ doc: `# Доставка\n${long}` });
    await service.mergeAndApply('t1', { sections: { payment: '- Передоплата' } });
    expect(applied()[1]).toContain(long.trim());
  });

  it('leaves payment details and checkout fields alone unless they are given', async () => {
    const { service, applied } = setup({
      doc: '# Доставка\n- Нова пошта',
      checkout: { paymentDetails: 'UA12 3456', fields: ['fullName', 'phone'] },
    });
    await service.mergeAndApply('t1', { sections: { returns: '- 14 днів' } });
    expect(applied()[3]).toBe('UA12 3456');
    expect(JSON.parse(applied()[2] as string)).toEqual({ fields: ['fullName', 'phone'] });
  });

  it('removes payment details only on an explicit null, and a section on an empty string', async () => {
    const { service, applied } = setup({
      doc: '# Доставка\n- Нова пошта\n\n# Розміри\n- Маломірять',
      checkout: { paymentDetails: 'UA12 3456' },
    });
    await service.mergeAndApply('t1', { sections: { sizes: '' }, paymentDetails: null });
    expect(applied()[1]).toBe('# Доставка\n- Нова пошта');
    expect(applied()[3]).toBeNull();
  });

  it('never rewrites the sizing advice, even when the stale draft carries one', async () => {
    const draft: NotesDraft = { ...emptyDraft(), sections: { delivery: '- Нова пошта' }, sizingAdvice: 'consult' };
    const { service, applied } = setup({ draft, doc: renderKnowledgeDoc(draft) });
    await service.mergeAndApply('t1', { sections: { returns: '- 14 днів' } });
    expect(applied()[4]).toBeNull();
  });
});
