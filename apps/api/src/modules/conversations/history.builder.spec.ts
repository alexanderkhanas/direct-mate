import { describeGap, HistoryBuilder } from './history.builder';

const HOUR = 60 * 60 * 1000;
const at = (hoursAgo: number) => new Date(Date.now() - hoursAgo * HOUR);

/** A fake DataSource that answers by which table the SQL reads. */
function builder(data: {
  messages?: Record<string, Array<{ role: string; text: string | null; attachments?: unknown; created_at: Date }>>;
  previous?: { id: string; last_message_at: Date } | null;
  draftItems?: Array<{ title: string; color: string | null; size: string | null; qty: number }>;
  orders?: Array<{ id: string; created_at: Date; status: string; total_amount: string; currency: string }>;
  orderItems?: Array<{ order_id: string; title: string; color: string | null; size: string | null; qty: number }>;
}) {
  const query = jest.fn(async (sql: string, params: unknown[]) => {
    if (sql.includes('FROM messages')) {
      const rows = (data.messages?.[params[0] as string] ?? []).map((m) => ({ attachments: null, ...m }));
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
      { role: 'customer', text: '(sent a photo)' },
      { role: 'manager', text: 'Зараз уточню' },
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

    expect(history[0]).toEqual({ role: 'customer', text: '(sent a photo earlier in the conversation; it is no longer attached)' });
    expect(history[1]).toEqual({ role: 'customer', text: '(sent a photo)', images: ['/uploads/customer-media/t1/1.jpg'] });
    expect(history[10]).toEqual({ role: 'customer', text: '(sent a photo)', images: ['/uploads/customer-media/t1/10.jpg'] });
    expect(history.slice(11)).toEqual([
      { role: 'customer', text: "(sent a photo that couldn't be loaded; ask them to send it again if you need it)" },
      { role: 'customer', text: "(sent a video; you can't watch videos, so ask for a photo or a description)" },
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
      { role: 'customer', text: '(replied to a story) (sent a photo) а ця є?', images: ['/uploads/customer-media/t1/a.jpg'] },
    ]);
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
      { role: 'customer', text: '(sent a photo)' },
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
