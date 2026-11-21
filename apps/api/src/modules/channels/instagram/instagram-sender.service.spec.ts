import { IG_TEXT_LIMIT_BYTES, InstagramSender, splitForInstagram } from './instagram-sender.service';

const bytes = (s: string) => Buffer.byteLength(s, 'utf8');

describe('splitForInstagram', () => {
  it('leaves a message that fits alone', () => {
    expect(splitForInstagram('  Так, є в L — 3300 грн.  ')).toEqual(['Так, є в L — 3300 грн.']);
  });

  it("splits Ukrainian text by Meta's byte limit, not by characters, at a paragraph or sentence", () => {
    const paragraph = 'Сорочка льон, чорна, L — 3300 грн. Є в наявності, відправимо завтра. ';
    const text = `${paragraph.repeat(6).trim()}\n\n${paragraph.repeat(4).trim()}`;
    expect(text.length).toBeLessThan(1000); // fits by characters…
    const parts = splitForInstagram(text);

    expect(parts.length).toBeGreaterThan(1); // …but not by bytes
    for (const part of parts) {
      expect(bytes(part)).toBeLessThanOrEqual(IG_TEXT_LIMIT_BYTES);
      expect(part).toMatch(/[.!?]$/);
    }
    expect(parts.join(' ').replace(/\s+/g, ' ')).toBe(text.replace(/\s+/g, ' '));
  });

  it('cuts inside a word only when there is nowhere else to cut', () => {
    const parts = splitForInstagram('я'.repeat(700));
    expect(parts.map(bytes)).toEqual([1000, 400]);
  });
});

describe('InstagramSender.sendImages', () => {
  const account = { token: 'tok', igAccountId: 'ig1', api: 'https://graph.facebook.com/v27.0' };
  const to = { id: 'cust' };
  const ctx = { tenantId: 't1', conversationId: 'c1', messageId: 'm1' };
  const config = { get: (key: string) => (key === 'app.baseUrl' ? 'https://shop.example' : undefined) };

  /** Meta answers each POST in turn: a message id, or an error status with a subcode. */
  function setup(answers: Array<string | { status: number; subcode?: number }>) {
    const bodies: Array<{ recipient: unknown; message: Record<string, unknown> }> = [];
    const queue = [...answers];
    jest.spyOn(global, 'fetch').mockImplementation(async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      const next = queue.shift() ?? 'mid-x';
      if (typeof next === 'string') return new Response(JSON.stringify({ message_id: next }), { status: 200 });
      return new Response(JSON.stringify({ error: { code: 100, error_subcode: next.subcode } }), { status: next.status });
    });
    const sender = new InstagramSender(config as never, { query: jest.fn(async () => []) } as never);
    return { sender, bodies };
  }

  afterEach(() => jest.restoreAllMocks());

  it("sends on the account's own host: graph.instagram.com for an Instagram Login connection", async () => {
    const urls: string[] = [];
    jest.spyOn(global, 'fetch').mockImplementation(async (url) => {
      urls.push(String(url));
      return new Response(JSON.stringify({ message_id: 'mid-1' }), { status: 200 });
    });
    const sender = new InstagramSender(config as never, { query: jest.fn(async () => []) } as never);
    await sender.sendText({ ...account, api: 'https://graph.instagram.com/v27.0' }, to, 'Привіт', ctx);
    await sender.sendText(account, to, 'Привіт', ctx);
    expect(urls).toEqual(['https://graph.instagram.com/v27.0/ig1/messages', 'https://graph.facebook.com/v27.0/ig1/messages']);
  });

  it('sends several photos as one message, and remembers the album for its echoes', async () => {
    const t = setup(['mid-album']);
    const mids = await t.sender.sendImages(account, to, ['/uploads/a.jpg', 'https://cdn/b.jpg'], ctx);

    expect(mids).toEqual(['mid-album']);
    expect(t.bodies).toEqual([
      {
        recipient: to,
        message: {
          attachments: [
            { type: 'image', payload: { url: 'https://shop.example/uploads/a.jpg' } },
            { type: 'image', payload: { url: 'https://cdn/b.jpg' } },
          ],
        },
      },
    ]);
    expect(t.sender.sentAlbumRecently('c1')).toBe(true);
    expect(t.sender.sentAlbumRecently('c2')).toBe(false);
  });

  it('sends one photo as a single attachment', async () => {
    const t = setup(['mid-1']);
    expect(await t.sender.sendImages(account, to, ['/uploads/a.jpg'], ctx)).toEqual(['mid-1']);
    expect(t.bodies[0].message).toEqual({ attachment: { type: 'image', payload: { url: 'https://shop.example/uploads/a.jpg' } } });
    expect(t.sender.sentAlbumRecently('c1')).toBe(false);
  });

  it('falls back to one by one when Meta refuses the album, and stops trying albums', async () => {
    const t = setup([{ status: 400, subcode: 2018007 }, 'mid-a', 'mid-b', 'mid-c', 'mid-d']);
    expect(await t.sender.sendImages(account, to, ['/uploads/a.jpg', '/uploads/b.jpg'], ctx)).toEqual(['mid-a', 'mid-b']);
    expect(t.bodies.map((b) => Object.keys(b.message)[0])).toEqual(['attachments', 'attachment', 'attachment']);

    // The next reply goes one by one straight away.
    await t.sender.sendImages(account, to, ['/uploads/c.jpg', '/uploads/d.jpg'], ctx);
    expect(t.bodies.slice(3).map((b) => Object.keys(b.message)[0])).toEqual(['attachment', 'attachment']);
  });

  it("keeps trying albums when only one file was the problem", async () => {
    const t = setup([{ status: 400, subcode: 2018008 }, 'mid-a', 'mid-b', 'mid-album']);
    await t.sender.sendImages(account, to, ['/uploads/a.jpg', '/uploads/b.jpg'], ctx);
    expect(await t.sender.sendImages(account, to, ['/uploads/a.jpg', '/uploads/c.jpg'], ctx)).toEqual(['mid-album']);
    expect(Object.keys(t.bodies[3].message)).toEqual(['attachments']);
  });

  it("never throws: a photo that can't be sent is left out", async () => {
    jest.useFakeTimers();
    try {
      // A server error isn't a refusal of albums; the second photo fails all three tries.
      const t = setup([{ status: 500 }, 'mid-a', { status: 400 }, { status: 400 }, { status: 400 }]);
      const sending = t.sender.sendImages(account, to, ['/uploads/a.jpg', '/uploads/b.jpg'], ctx);
      await jest.advanceTimersByTimeAsync(10_000);
      expect(await sending).toEqual(['mid-a']);
    } finally {
      jest.useRealTimers();
    }
  });
});
