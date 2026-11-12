import { describeGap, HistoryBuilder } from './history.builder';

const HOUR = 60 * 60 * 1000;
const at = (hoursAgo: number) => new Date(Date.now() - hoursAgo * HOUR);

/** A fake DataSource that answers by which table the SQL reads. */
function builder(data: {
  messages?: Record<
    string,
    Array<{ role: string; text: string | null; attachments?: unknown; products?: unknown; created_at: Date }>
  >;
  previous?: { id: string; last_message_at: Date } | null;
  draftItems?: Array<{ title: string; color: string | null; size: string | null; qty: number }>;
  orders?: Array<{ id: string; created_at: Date; status: string; total_amount: string; currency: string }>;
  orderItems?: Array<{ order_id: string; title: string; color: string | null; size: string | null; qty: number }>;
}) {
  const query = jest.fn(async (sql: string, params: unknown[]) => {
    if (sql.includes('FROM messages')) {
      const rows = (data.messages?.[params[0] as string] ?? []).map((m) => ({ attachments: null, products: null, ...m }));
      // The builder asks newest-first and reverses.
      return [...rows].reverse().slice(0, params[1] as number);
    }
    if (sql.includes('FROM conversations')) return data.previous ? [data.previous] : [];
    if (sql.includes('FROM checkout_sessions')) return data.draftItems ?? [];
    if (sql.includes('FROM orders')) return data.orders ?? [];
    if (sql.includes('FROM order_items')) return data.orderItems ?? [];
    return [];
  });
  return new HistoryBuilder({ query } as never);
}

const CONVERSATION = { id: 'c2', tenantId: 't1', customerId: 'u1' };

describe('HistoryBuilder', () => {
  it('maps roles, labels media-only messages and marks gaps of 2 hours or more', async () => {
    const history = await builder({
      messages: {
        c2: [
          { role: 'user', text: 'Скільки коштує сорочка?', created_at: at(6) },
          { role: 'assistant', text: '3300 грн', created_at: at(6) },
          { role: 'user', text: '', attachments: [{ type: 'customer_photo', mediaId: 'x' }], created_at: at(1) },
          { role: 'manager', text: 'Зараз уточню', created_at: at(0.5) },
          { role: 'system', text: 'internal', created_at: at(0.4) },
        ],
      },
    }).build(CONVERSATION);

    expect(history).toEqual([
      { role: 'customer', text: 'Скільки коштує сорочка?' },
      { role: 'bot', text: '3300 грн' },
      { role: 'note', text: '— 5 hours later —' },
      { role: 'customer', text: '(sent a photo)', said: '' },
      { role: 'manager', text: 'Зараз уточню' },
    ]);
  });

  it('names the products each bot reply was about in a note after it, never in the reply itself', async () => {
    const history = await builder({
      messages: {
        c2: [
          { role: 'user', text: 'Біла сорочка в M є?', created_at: at(0.2) },
          {
            role: 'assistant',
            text: 'Є дві: Сорочка з льону і Premium.',
            products: [
              { ref: '5d041fb6', title: 'Сорочка льон' },
              { ref: '007ad88f', title: 'Сорочка льон Premium' },
            ],
            created_at: at(0.2),
          },
          { role: 'user', text: 'давайте звичайну', created_at: at(0.1) },
        ],
      },
    }).build(CONVERSATION);

    expect(history).toEqual([
      { role: 'customer', text: 'Біла сорочка в M є?' },
      { role: 'bot', text: 'Є дві: Сорочка з льону і Premium.' },
      {
        role: 'note',
        text: 'Products in the reply above: «Сорочка льон» ref 5d041fb6, «Сорочка льон Premium» ref 007ad88f.',
      },
      { role: 'customer', text: 'давайте звичайну' },
    ]);
  });

  it("attaches the conversation's newest 10 photos as images and says why any other is missing", async () => {
    const photo = (n: number) => ({
      role: 'user',
      text: '',
      attachments: [{ type: 'customer_photo', mediaId: `https://cdn/${n}.jpg`, url: `/uploads/customer-media/t1/${n}.jpg` }],
      created_at: at(1),
    });
    const history = await builder({
      messages: {
        c2: [
          ...Array.from({ length: 11 }, (_, n) => photo(n)),
          { role: 'user', text: '', attachments: [{ type: 'customer_photo', mediaId: 'https://cdn/x.jpg', error: 'download_failed' }], created_at: at(0.5) },
          { role: 'user', text: '', attachments: [{ type: 'customer_video', mediaId: 'v1' }], created_at: at(0.5) },
          { role: 'user', text: 'Є така в L?', created_at: at(0.5) },
        ],
      },
    }).build(CONVERSATION);

    expect(history[0]).toEqual({ role: 'customer', text: '(sent a photo earlier in the conversation; it is no longer attached)', said: '' });
    expect(history[1]).toEqual({ role: 'customer', text: '(sent a photo)', said: '', images: ['/uploads/customer-media/t1/1.jpg'] });
    expect(history[10]).toEqual({ role: 'customer', text: '(sent a photo)', said: '', images: ['/uploads/customer-media/t1/10.jpg'] });
    expect(history.slice(11)).toEqual([
      { role: 'customer', text: "(sent a photo that couldn't be loaded; ask them to send it again if you need it)", said: '' },
      { role: 'customer', text: "(sent a video; you can't watch videos, so ask for a photo or a description)", said: '' },
      { role: 'customer', text: 'Є така в L?' },
    ]);
  });

  it('labels every attachment of a message, not just the first, next to its text', async () => {
    const history = await builder({
      messages: {
        c2: [
          {
            role: 'user',
            text: 'а ця є?',
            attachments: [
              { type: 'story_reply', mediaId: 's1' },
              { type: 'customer_photo', mediaId: '/uploads/customer-media/t1/a.jpg', url: '/uploads/customer-media/t1/a.jpg' },
            ],
            created_at: at(0),
          },
        ],
      },
    }).build(CONVERSATION);

    expect(history).toEqual([
      { role: 'customer', text: "(replied to the shop's story; you can't see it) (sent a photo) а ця є?", said: 'а ця є?', images: ['/uploads/customer-media/t1/a.jpg'] },
    ]);
  });

  it('shows the story, post or reel the customer pointed at as an image, labelled, with its caption', async () => {
    const story = '/uploads/content-media/t1/story-frames.jpg';
    const post = '/uploads/content-media/t1/post.jpg';
    const reel = '/uploads/content-media/t1/reel.jpg';
    const history = await builder({
      messages: {
        c2: [
          {
            role: 'user',
            text: 'є в M?',
            attachments: [{ type: 'story_reply', mediaId: 's1', url: story, image: 'video_frames' }],
            created_at: at(0.4),
          },
          {
            role: 'user',
            text: '',
            attachments: [{ type: 'post_share', mediaId: 'p1', url: post, image: 'picture', caption: `Сукня льон\n\n${'дуже '.repeat(80)}` }],
            created_at: at(0.3),
          },
          {
            role: 'user',
            text: '',
            attachments: [{ type: 'post_share', mediaId: 'r1', url: reel, image: 'video_cover', reel: true, foreign: true }],
            created_at: at(0.2),
          },
          { role: 'user', text: 'Ціна?', attachments: [{ type: 'post_comment', mediaId: 'p2', caption: 'Нова колекція' }], created_at: at(0.1) },
          { role: 'user', text: 'А штани є?', attachments: [{ type: 'post_share', mediaId: 'r2', reel: true, foreign: true }], created_at: at(0) },
        ],
      },
    }).build(CONVERSATION);

    expect(history[0]).toEqual({
      role: 'customer',
      text: "(replied to the shop's story, a video: the image shows frames from it) є в M?",
      said: 'є в M?',
      images: [story],
    });
    expect(history[1].text).toMatch(/^\(shared a post, shown in the image; caption: «Сукня льон дуже дуже .*… \(cut\)»\)$/);
    expect(history[1].text.length).toBeLessThan(400);
    expect(history[1]).toMatchObject({ images: [post] });
    expect(history[2]).toEqual({
      role: 'customer',
      text: '(shared a reel from another account, a video: the image is its cover)',
      said: '',
      images: [reel],
    });
    // No copy: the agent is told it can't see it, so it doesn't ask as if it could.
    expect(history[3]).toEqual({
      role: 'customer',
      text: "(commented under the shop's post; you can't see it, only its caption: «Нова колекція») Ціна?",
      said: 'Ціна?',
    });
    expect(history[4]).toEqual({ role: 'customer', text: "(shared a reel from another account; you can't see it) А штани є?", said: 'А штани є?' });
  });

  it('counts content images toward the same cap as photos, keeping the newest', async () => {
    const photo = (n: number) => ({
      role: 'user',
      text: '',
      attachments: [{ type: 'customer_photo', mediaId: `https://cdn/${n}.jpg`, url: `/uploads/customer-media/t1/${n}.jpg` }],
      created_at: at(1),
    });
    const history = await builder({
      messages: {
        c2: [
          { role: 'user', text: '', attachments: [{ type: 'story_reply', mediaId: 's1', url: '/uploads/content-media/t1/s.jpg', image: 'picture', caption: 'Сукня' }], created_at: at(2) },
          ...Array.from({ length: 10 }, (_, n) => photo(n)),
        ],
      },
    }).build(CONVERSATION);

    expect(history[0]).toEqual({ role: 'customer', text: "(replied to the shop's story; its image is no longer attached; caption: «Сукня»)", said: '' });
    expect(history.filter((e) => e.role === 'customer' && e.images).length).toBe(10);
  });

  it("gives the new messages' attachments from the same rows, with a content copy only when the history shows it", async () => {
    const story = { type: 'story_reply', mediaId: 's1', url: '/uploads/content-media/t1/s.jpg', image: 'picture', caption: 'Сукня' };
    const photo = (n: number) => ({
      type: 'customer_photo',
      mediaId: `https://cdn/${n}.jpg`,
      url: `/uploads/customer-media/t1/${n}.jpg`,
    });
    const { history, newAttachments } = await builder({
      messages: {
        c2: [
          { role: 'user', text: '', attachments: [{ type: 'post_share', mediaId: 'old' }], created_at: at(3) },
          { role: 'assistant', text: 'Вітаю!', created_at: at(2.5) },
          { role: 'user', text: 'є в M?', attachments: [story], created_at: at(2) },
          // Ten newer photos push the story's copy out of the images.
          ...Array.from({ length: 10 }, (_, n) => ({ role: 'user', text: '', attachments: [photo(n)], created_at: at(1) })),
        ],
      },
    }).buildTurn(CONVERSATION);

    expect(history.find((e) => e.text.includes('story'))).not.toHaveProperty('images');
    expect(newAttachments).toEqual([
      { type: 'story_reply', mediaId: 's1', caption: 'Сукня' },
      ...Array.from({ length: 10 }, (_, n) => photo(n)),
    ]);
  });

  it("names the shop's content the customer pointed at last, never another account's post or a link", async () => {
    const turn = (attachments: unknown[][]) =>
      builder({
        messages: {
          c2: attachments.map((a, i) => ({ role: 'user', text: '', attachments: a, created_at: at(attachments.length - i) })),
        },
      }).buildTurn(CONVERSATION);

    const story = { type: 'story_reply', mediaId: 's1' };
    const post = { type: 'post_share', mediaId: 'p1' };
    expect((await turn([[story], [post]])).focusMediaId).toBe('p1');
    // Another account's post, a pasted link, a photo: the shop's story before them still counts.
    expect(
      (await turn([[story], [{ type: 'post_share', mediaId: 'p9', foreign: true }], [{ type: 'post_reply', mediaId: 'https://instagram.com/p/x' }], [{ type: 'customer_photo', mediaId: 'https://cdn/x.jpg' }]]))
        .focusMediaId,
    ).toBe('s1');
    expect((await turn([[{ type: 'customer_photo', mediaId: 'https://cdn/x.jpg' }]])).focusMediaId).toBeNull();
  });

  it('shows what a quote-reply quoted, labels story mentions and cuts very long messages', async () => {
    const history = await builder({
      messages: {
        c2: [
          {
            role: 'user',
            text: 'а ця в L є?',
            attachments: [{ type: 'quoted_message', mediaId: 'mid1', quotedText: 'Сорочка льон — 3300 грн' }],
            created_at: at(0),
          },
          { role: 'user', text: '', attachments: [{ type: 'story_mention', mediaId: 'x' }], created_at: at(0) },
          { role: 'user', text: 'я'.repeat(2500), created_at: at(0) },
        ],
      },
    }).build(CONVERSATION);

    expect(history[0].text).toBe('(replying to «Сорочка льон — 3300 грн») а ця в L є?');
    expect(history[1].text).toBe('(mentioned the shop in their story)');
    expect(history[2].text).toBe(`${'я'.repeat(2000)}… (cut)`);
  });

  it('adds the previous conversation as labelled context, with its unfinished order', async () => {
    const history = await builder({
      messages: {
        c1: [
          {
            role: 'user',
            text: '',
            attachments: [{ type: 'customer_photo', mediaId: 'x', url: '/uploads/customer-media/t1/old.jpg' }],
            created_at: at(30),
          },
          { role: 'user', text: 'а чорна є?', created_at: at(30) },
          { role: 'assistant', text: 'Так, чорна є в L', created_at: at(30) },
        ],
        c2: [{ role: 'user', text: 'а в M?', created_at: at(0) }],
      },
      previous: { id: 'c1', last_message_at: at(30) },
      draftItems: [{ title: 'Сорочка льон', color: 'Чорний', size: 'L', qty: 1 }],
    }).build(CONVERSATION);

    expect(history[0].role).toBe('note');
    expect(history[0].text).toContain('Earlier conversation with this customer, 1 day ago');
    // The old messages keep their roles, so a customer's words never come back as system text.
    // Photos from an earlier conversation are named, not re-sent.
    expect(history.slice(1)).toEqual([
      { role: 'customer', text: '(sent a photo)', said: '' },
      { role: 'customer', text: 'а чорна є?' },
      { role: 'bot', text: 'Так, чорна є в L' },
      {
        role: 'note',
        text: "They didn't finish an order then: Сорочка льон (Чорний, L) ×1. It is no longer active; offer to put it together again only if they ask.",
      },
      { role: 'note', text: "— end of the earlier conversation; today's messages follow —" },
      { role: 'customer', text: 'а в M?' },
    ]);
  });

  it("lists the customer's recent orders from the database", async () => {
    const history = await builder({
      messages: { c2: [{ role: 'user', text: 'коли відправка?', created_at: at(0) }] },
      orders: [{ id: 'o1', created_at: at(48), status: 'awaiting_manager_confirmation', total_amount: '3300', currency: 'UAH' }],
      orderItems: [{ order_id: 'o1', title: 'Сорочка льон', color: 'Black', size: 'L', qty: 1 }],
    }).build(CONVERSATION);

    expect(history[0].text).toContain("This customer's orders");
    expect(history[0].text).toContain('Сорочка льон (Чорний, L) ×1, 3300 грн; status awaiting manager confirmation');
  });
});

describe('describeGap', () => {
  it('speaks in hours under a day and in days after', () => {
    expect(describeGap(20 * 60 * 1000)).toBe('1 hour');
    expect(describeGap(5 * HOUR)).toBe('5 hours');
    expect(describeGap(30 * HOUR)).toBe('1 day');
    expect(describeGap(72 * HOUR)).toBe('3 days');
  });
});
