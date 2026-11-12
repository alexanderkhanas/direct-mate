import { ASK_AT, ContentVerifierService, KEEP_AT, articles } from './content-verifier.service';

const MAPPING = { id: 'm1', image_path: null, thumbnail_url: null, media_url: 'https://cdn/story.jpg', media_type: 'story', caption: null };

type Generated = { output: unknown; usage: { inputTokens: number; outputTokens: number } };

/** The verifier with its two model calls answered in order. */
class TestVerifier extends ContentVerifierService {
  calls: Array<{ name: string; content: unknown }> = [];
  constructor(deps: ConstructorParameters<typeof ContentVerifierService>, private readonly answers: Array<Generated | Error>) {
    super(...deps);
  }
  protected async generate(_schema: unknown, name: string, _instructions: string, content: unknown): Promise<never> {
    this.calls.push({ name, content });
    const next = this.answers.shift();
    if (!next) throw new Error(`unexpected call ${name}`);
    if (next instanceof Error) throw next;
    return next as never;
  }
}

const items = (list: Array<{ what: string; category: string; text?: string | null }>): Generated => ({
  output: { items: list.map((i) => ({ text: null, ...i })) },
  usage: { inputTokens: 1000, outputTokens: 50 },
});
const verdicts = (list: Array<Record<string, unknown>>): Generated => ({
  output: { verdicts: list.map((v) => ({ sameColour: true, reason: 'Ті самі затяжки й кишені.', ...v })) },
  usage: { inputTokens: 3000, outputTokens: 80 },
});

function setup(answers: Array<Generated | Error>, opts: { claimed?: typeof MAPPING | null } = {}) {
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  const dataSource = {
    query: jest.fn(async (sql: string, params: unknown[] = []) => {
      queries.push({ sql, params });
      if (sql.includes('SET vision_checked_at = now()')) return opts.claimed === null ? [[], 0] : [[opts.claimed ?? MAPPING], 1];
      if (sql.includes('FROM content_products WHERE tenant_id = $1 AND mapping_id = $2')) return [];
      if (sql.includes('JOIN product_media pm')) {
        return [
          { product_id: 'p-zat', title: 'Штани з затяжками', url: 'https://cdn/zat-navy.jpg', color: 'Темно-синій' },
          { product_id: 'p-zat', title: 'Штани з затяжками', url: 'https://cdn/zat-black.jpg', color: 'Чорний' },
          { product_id: 'p-knit', title: 'Трикотажні штани з вовною', url: 'https://cdn/knit.jpg', color: 'Бежевий меланж' },
        ];
      }
      return [[], 1];
    }),
  };
  const search = {
    search: jest.fn(async () => ({ ids: ['p-zat', 'p-knit'], total: 2 })),
    findBySku: jest.fn(async () => []),
  };
  const links = { autoLink: jest.fn(async (..._args: unknown[]) => true), findId: jest.fn(async () => 'l1') };
  const questions = { ask: jest.fn(async () => true) };
  const config = { get: () => undefined };
  const verifier = new TestVerifier([dataSource, config, search, links, questions] as never, answers);
  return { verifier, queries, search, links, questions };
}

describe('ContentVerifierService', () => {
  it('claims the content once, and only content nobody confirmed', async () => {
    const t = setup([items([])]);
    await t.verifier.verify('t1', 's1');
    const claim = t.queries[0];
    expect(claim.sql).toMatch(/m\.vision_checked_at IS NULL/);
    expect(claim.sql).toMatch(/NOT EXISTS \(SELECT 1 FROM content_products cp WHERE cp\.mapping_id = m\.id AND cp\.status = 'confirmed'\)/);
    expect(claim.params).toEqual(['t1', 's1']);

    const taken = setup([], { claimed: null });
    expect(await taken.verifier.verify('t1', 's1')).toBeNull();
    expect(taken.verifier.calls).toHaveLength(0);
  });

  it('gives the claim back when there is no picture yet, or the model fails, so a later call tries again', async () => {
    const noPicture = setup([], { claimed: { ...MAPPING, media_type: 'video', media_url: 'https://cdn/s.mp4' } });
    expect(await noPicture.verifier.verify('t1', 's1')).toBeNull();
    expect(noPicture.queries.at(-1)!.sql).toMatch(/SET vision_checked_at = NULL WHERE id = \$1/);

    const failing = setup([new Error('timeout')]);
    await expect(failing.verifier.verify('t1', 's1')).rejects.toThrow('timeout');
    expect(failing.queries.at(-1)!.sql).toMatch(/SET vision_checked_at = NULL WHERE id = \$1/);
  });

  it('keeps a confident «same» as a suggestion with its reason, in the colour pictured, and asks the owner', async () => {
    const t = setup([
      items([{ what: 'чорні штани на зав’язках', category: 'Штани' }]),
      verdicts([{ item: 1, candidate: 1, verdict: 'same', confidence: ASK_AT }]),
    ]);
    const out = await t.verifier.verify('t1', 's1');

    expect(out).toHaveLength(1);
    expect(t.links.autoLink).toHaveBeenCalledWith('t1', { mappingId: 'm1' }, {
      productId: 'p-zat',
      color: 'Чорний',
      source: 'vision',
      status: 'suggested',
      confidence: ASK_AT,
      evidence: { reason: 'Ті самі затяжки й кишені.' },
    });
    expect(t.questions.ask).toHaveBeenCalledWith('t1', 'l1');
    // The comparison saw the black photo, not the first one.
    const compared = JSON.stringify(t.verifier.calls[1].content);
    expect(compared).toContain('zat-black.jpg');
    expect(compared).not.toContain('zat-navy.jpg');
  });

  it("keeps a less sure «same» without asking, links the product in every colour when the colour differs, and drops the rest", async () => {
    const t = setup([
      items([
        { what: 'чорні штани', category: 'Штани' },
        { what: 'сірий светр', category: 'Светри' },
        { what: 'кеди', category: 'Кеди' },
      ]),
      verdicts([
        { item: 1, candidate: 1, verdict: 'same', confidence: KEEP_AT, sameColour: false },
        { item: 2, candidate: null, verdict: 'none', confidence: 0.9 },
        { item: 3, candidate: 2, verdict: 'same', confidence: KEEP_AT - 0.1 },
      ]),
    ]);
    await t.verifier.verify('t1', 's1');
    expect(t.links.autoLink).toHaveBeenCalledTimes(1);
    expect(t.links.autoLink.mock.calls[0][2]).toMatchObject({ productId: 'p-zat', color: null });
    expect(t.questions.ask).not.toHaveBeenCalled();
  });

  it('treats a «same» pointing at no valid candidate as unsure, and ignores an unknown item', async () => {
    const t = setup([
      items([{ what: 'чорні штани', category: 'Штани' }]),
      verdicts([
        { item: 1, candidate: 9, verdict: 'same', confidence: 0.95 },
        { item: 4, candidate: 1, verdict: 'same', confidence: 0.95 },
      ]),
    ]);
    const out = await t.verifier.verify('t1', 's1');
    expect(out).toEqual([expect.objectContaining({ verdict: 'unsure', candidate: null })]);
    expect(t.links.autoLink).not.toHaveBeenCalled();
  });

  it('looks an article up first, and adds up both calls in the usage', async () => {
    const t = setup([
      items([{ what: 'чорні штани', category: 'Штани', text: 'Арт. AM-2041 · 3200 грн' }]),
      verdicts([{ item: 1, candidate: null, verdict: 'none', confidence: 0.7 }]),
    ]);
    const result = await t.verifier.check('t1', { mappingId: 'm1', image: 'https://cdn/story.jpg', caption: 'Нова колекція' });
    expect(t.search.findBySku).toHaveBeenCalledWith('t1', 'AM-2041');
    expect(result!.usage).toEqual({ inputTokens: 4000, outputTokens: 130 });
    expect(JSON.stringify(t.verifier.calls[0].content)).toContain('Caption: «Нова колекція»');
  });

  it('reads possible articles off the text on an item, not prices', () => {
    expect(articles('Арт. AM-2041 · 3200грн')).toEqual(['AM-2041']);
    expect(articles('«Поло» 490')).toEqual(['490']);
    expect(articles(null)).toEqual([]);
  });
});
