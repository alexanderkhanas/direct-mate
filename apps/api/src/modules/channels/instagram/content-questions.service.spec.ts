import { ContentQuestionsService, MAX_QUESTIONS_PER_DAY, questionText } from './content-questions.service';

const LINK = '0b77dcd2-0000-0000-0000-000000000000';
const CLAIMED = {
  id: LINK,
  source: 'conversation',
  color: 'Чорний',
  title: 'Штани з затяжками',
  media_type: 'story',
  media_product_type: null,
  image_path: '/uploads/content-media/t1/s.jpg',
};

function setup(opts: { claimed?: boolean; sent?: number; chats?: string[]; changed?: Array<{ id: string; status: string; ownerAskedAt: Date | null }> } = {}) {
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  const dataSource = {
    query: jest.fn(async (sql: string, params: unknown[] = []) => {
      queries.push({ sql, params });
      if (sql.includes('SET owner_asked_at = now()')) return opts.claimed === false ? [[], 0] : [[CLAIMED], 1];
      if (sql.includes('SELECT tenant_id FROM content_products')) return [{ tenant_id: 't1' }];
      return [[], 1];
    }),
  };
  let handler: ((data: string, chatId: string) => Promise<string | null>) | undefined;
  const telegram = {
    onCallback: jest.fn((_prefix: string, h: typeof handler) => (handler = h)),
    askTenant: jest.fn(async () => opts.sent ?? 1),
    chatIdsFor: jest.fn(async () => opts.chats ?? ['111']),
  };
  const links = {
    addOrder: jest.fn(async () => opts.changed ?? []),
    setStatus: jest.fn(async () => true),
  };
  const service = new ContentQuestionsService(dataSource as never, telegram as never, links as never);
  service.onModuleInit();
  return { service, queries, telegram, links, tap: (data: string, chat: string) => handler!(data, chat) };
}

describe('ContentQuestionsService', () => {
  it('asks once per link, within a daily cap, claiming it before sending', async () => {
    const t = setup();
    expect(await t.service.ask('t1', LINK)).toBe(true);
    const claim = t.queries[0];
    expect(claim.sql).toMatch(/cp\.status = 'suggested' AND cp\.owner_asked_at IS NULL/);
    expect(claim.sql).toMatch(/owner_asked_at > now\(\) - interval '1 day'\) < \$3/);
    expect(claim.params).toEqual([LINK, 't1', MAX_QUESTIONS_PER_DAY]);
    expect(t.telegram.askTenant).toHaveBeenCalledWith('t1', {
      text: expect.stringContaining('Клієнт, який писав про цю сторіс, замовив «Штани з затяжками» (чорний).'),
      imagePath: '/uploads/content-media/t1/s.jpg',
      buttons: [
        { text: 'Так, це він', data: `cl:${LINK}:y` },
        { text: 'Ні', data: `cl:${LINK}:n` },
      ],
    });
  });

  it('sends nothing when the claim fails (asked before, not a suggestion, or the cap reached)', async () => {
    const t = setup({ claimed: false });
    expect(await t.service.ask('t1', LINK)).toBe(false);
    expect(t.telegram.askTenant).not.toHaveBeenCalled();
  });

  it('lets a later order ask again when no chat got the question', async () => {
    const t = setup({ sent: 0 });
    expect(await t.service.ask('t1', LINK)).toBe(false);
    expect(t.queries.at(-1)!.sql).toMatch(/SET owner_asked_at = NULL WHERE id = \$1/);
  });

  it("asks about a suggestion's first order only", async () => {
    const t = setup({
      changed: [
        { id: LINK, status: 'suggested', ownerAskedAt: null },
        { id: 'asked', status: 'suggested', ownerAskedAt: new Date() },
        { id: 'sure', status: 'confirmed', ownerAskedAt: null },
      ],
    });
    await t.service.afterOrder('t1', 'c1', { orderId: 'o1', checkoutSessionId: 's1' });
    expect(t.links.addOrder).toHaveBeenCalledWith('t1', 'c1', { orderId: 'o1', checkoutSessionId: 's1' });
    expect(t.telegram.askTenant).toHaveBeenCalledTimes(1);
  });

  it("applies a tap from the store's chat, and ignores one from any other chat or a malformed button", async () => {
    const t = setup({ chats: ['111'] });
    expect(await t.tap(`cl:${LINK}:y`, '111')).toMatch(/^✅ Підтверджено/);
    expect(t.links.setStatus).toHaveBeenLastCalledWith('t1', LINK, 'confirmed');
    expect(await t.tap(`cl:${LINK}:n`, '111')).toMatch(/^❌ Відхилено/);
    expect(t.links.setStatus).toHaveBeenLastCalledWith('t1', LINK, 'rejected');

    t.links.setStatus.mockClear();
    expect(await t.tap(`cl:${LINK}:y`, '999')).toBeNull();
    expect(await t.tap('cl:not-a-link:y', '111')).toBeNull();
    expect(t.links.setStatus).not.toHaveBeenCalled();
  });

  it('words the question for a reel, a post and the visual check', () => {
    expect(questionText({ ...CLAIMED, media_type: 'video', media_product_type: 'REELS' })).toContain('писав про цей рілс');
    expect(questionText({ ...CLAIMED, media_type: 'image', color: null })).toContain('замовив «Штани з затяжками».\nУ дописі саме цей товар?');
    expect(questionText({ ...CLAIMED, source: 'vision' })).toContain('AI-агент порівняв цю сторіс з каталогом: схоже, це «Штани з затяжками» (чорний).');
  });
});
