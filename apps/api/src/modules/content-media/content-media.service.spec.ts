import { mkdir, mkdtemp, readdir, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import sharp = require('sharp');
import { safeFetch, TooLargeError } from '../../common/safe-fetch';
import { ImageHashService } from '../catalog/image-hash.service';
import { CustomerMediaService } from '../customer-media/customer-media.service';
import type { MessageAttachment } from '../conversations/entities/message.entity';
import { ContentMediaService } from './content-media.service';
import { extractFrames } from './video-frames';

// ffmpeg and the network are faked; sharp, the hashes and the files are real (in a temp folder).
jest.mock('./video-frames', () => ({ ...jest.requireActual('./video-frames'), extractFrames: jest.fn() }));
const frames = extractFrames as jest.MockedFunction<typeof extractFrames>;
jest.mock('../../common/safe-fetch', () => ({ ...jest.requireActual('../../common/safe-fetch'), safeFetch: jest.fn() }));
const safeFetchMock = safeFetch as jest.MockedFunction<typeof safeFetch>;

const W = 180;
const H = 320;
/** Test pictures whose difference hashes are far apart (solid colours all hash alike). */
const PATTERNS: Record<string, (x: number, y: number) => number> = {
  rising: (x) => 30 + x,
  falling: (x) => 220 - x,
  stripes: (x) => (Math.floor(x / 20) % 2 ? 220 : 30),
  split: (x, y) => (y < H / 2 ? 30 + x : 220 - x),
  checker: (x, y) => ((Math.floor(x / 20) + Math.floor(y / 40)) % 2 ? 220 : 30),
};
function picture(name: keyof typeof PATTERNS): Promise<Buffer> {
  const f = PATTERNS[name];
  const raw = Buffer.alloc(W * H * 3);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) raw.fill(Math.round(f(x, y)), (y * W + x) * 3, (y * W + x) * 3 + 3);
  return sharp(raw, { raw: { width: W, height: H, channels: 3 } }).jpeg({ quality: 95 }).toBuffer();
}
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypmp42'), Buffer.alloc(64)]);

type File = { body: Buffer; type: string };
/** A file, an HTTP status, or a file that arrives when the test lets it. */
type Routes = Record<string, File | number | (() => Promise<File>)>;

function setup(
  opts: {
    row?: Record<string, unknown> | null;
    details?: Record<string, unknown> | null;
    /** Graph refused the media (the default) rather than failing briefly. */
    refused?: boolean;
    routes?: Routes;
  } = {},
) {
  const content = {
    findByMediaId: jest.fn(async () => opts.row ?? null),
    readMediaDetails: jest.fn(async (_t: string, _id: string) =>
      opts.details ? { details: opts.details } : { details: null, refused: opts.refused ?? true },
    ),
    saveUnlinkedMedia: jest.fn(async () => undefined),
    saveContentImage: jest.fn(async () => undefined),
  };
  const writes: Array<{ messageId: string; index: string; attachment: MessageAttachment }> = [];
  const dataSource = {
    query: jest.fn(async (sql: string, params: unknown[]): Promise<unknown[]> => {
      if (sql.includes('jsonb_set')) {
        writes.push({ messageId: params[0] as string, index: params[1] as string, attachment: JSON.parse(params[2] as string) });
      }
      return [];
    }),
  };
  const fetched: string[] = [];
  // safeFetch as the downloads use it: the headers hook, the size cap, and the body to a file or back.
  safeFetchMock.mockImplementation(async (url, options = {}) => {
    fetched.push(url);
    const route = opts.routes?.[url];
    const found = typeof route === 'function' ? await route() : route;
    const status = found === undefined ? 404 : typeof found === 'number' ? found : 200;
    const headers: Record<string, string> = typeof found === 'object' ? { 'content-type': found.type } : {};
    options.onHeaders?.(status, headers);
    const body = typeof found === 'object' ? found.body : Buffer.from('nope');
    if (body.length > (options.maxBytes ?? Infinity)) throw new TooLargeError(`${url} is larger than the cap`);
    if (options.toFile) {
      await writeFile(options.toFile, body);
      return { status, headers, body: Buffer.alloc(0), url };
    }
    return { status, headers, body, url };
  });
  const service = new ContentMediaService(
    content as never,
    new CustomerMediaService(),
    new ImageHashService(),
    dataSource as never,
  );
  return { service, content, dataSource, writes, fetched };
}

describe('ContentMediaService', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'content-media-'));
    jest.spyOn(process, 'cwd').mockReturnValue(root);
    frames.mockReset();
    safeFetchMock.mockReset();
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    jest.useRealTimers();
    await rm(root, { recursive: true, force: true });
  });

  it('uses the copy already kept for that story, without asking Graph or downloading', async () => {
    await mkdir(join(root, 'uploads/content-media/t1'), { recursive: true });
    await writeFile(join(root, 'uploads/content-media/t1/known-frames.jpg'), await picture('rising'));
    const t = setup({ row: { imagePath: '/uploads/content-media/t1/known-frames.jpg', caption: 'Сукня льон', mediaProductType: 'STORY' } });

    expect(await t.service.capture('t1', { type: 'story_reply', mediaId: 's1', sourceUrl: 'https://cdn/s.jpg' })).toEqual({
      url: '/uploads/content-media/t1/known-frames.jpg',
      image: 'video_frames',
      caption: 'Сукня льон',
    });
    expect(t.content.readMediaDetails).not.toHaveBeenCalled();
    expect(t.fetched).toEqual([]);
  });

  it("copies the shop's own post from Graph's media_url, and keeps the copy and caption on its row", async () => {
    const big = await sharp({ create: { width: 2000, height: 1500, channels: 3, background: '#336699' } }).png().toBuffer();
    const t = setup({
      details: { mediaUrl: 'https://graph-cdn/p.jpg', caption: 'Сукня льон, арт. LV-2933', mediaType: 'image', permalink: 'https://ig/p/1', productType: 'FEED' },
      routes: { 'https://graph-cdn/p.jpg': { body: big, type: 'image/png' } },
    });

    const out = await t.service.capture('t1', { type: 'post_share', mediaId: 'p1', sourceUrl: 'https://cdn/p.jpg' });
    expect(out).toMatchObject({ image: 'picture', caption: 'Сукня льон, арт. LV-2933' });
    expect(out.url).toMatch(/^\/uploads\/content-media\/t1\/[0-9a-f-]{36}\.jpg$/);
    expect(out.foreign).toBeUndefined();
    const meta = await sharp(join(root, out.url!)).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(['jpeg', 1024, 768]);
    expect(t.content.saveUnlinkedMedia).toHaveBeenCalledWith('t1', 'p1', 'image', expect.objectContaining({
      caption: 'Сукня льон, арт. LV-2933',
      mediaUrl: 'https://graph-cdn/p.jpg',
      permalink: 'https://ig/p/1',
      productType: 'FEED',
      imagePath: out.url,
    }), null);
  });

  it('keeps the copy on a linked row without touching the link', async () => {
    const t = setup({
      row: { productId: 'prod-1', imagePath: null },
      details: { mediaUrl: 'https://graph-cdn/p.jpg', mediaType: 'image' },
      routes: { 'https://graph-cdn/p.jpg': { body: await picture('rising'), type: 'image/jpeg' } },
    });
    const out = await t.service.capture('t1', { type: 'post_comment', mediaId: 'p1' });
    expect(t.content.saveContentImage).toHaveBeenCalledWith('t1', 'p1', out.url, null);
    expect(t.content.saveUnlinkedMedia).not.toHaveBeenCalled();
  });

  it("replaces a kept copy whose file is gone, on a linked row and an unlinked one", async () => {
    const routes = { 'https://graph-cdn/p.jpg': { body: await picture('rising'), type: 'image/jpeg' } };
    const details = { mediaUrl: 'https://graph-cdn/p.jpg', mediaType: 'image' };
    const gone = '/uploads/content-media/t1/gone.jpg';

    const linked = setup({ row: { productId: 'prod-1', imagePath: gone }, details, routes });
    const out = await linked.service.capture('t1', { type: 'post_comment', mediaId: 'p1' });
    expect(out.url).not.toBe(gone);
    expect(linked.content.saveContentImage).toHaveBeenCalledWith('t1', 'p1', out.url, gone);

    const unlinked = setup({ row: { productId: null, imagePath: gone }, details, routes });
    const again = await unlinked.service.capture('t1', { type: 'story_reply', mediaId: 's1' });
    expect(unlinked.content.saveUnlinkedMedia).toHaveBeenCalledWith('t1', 's1', 'story', expect.objectContaining({ imagePath: again.url }), gone);
  });

  it("doesn't reuse a kept path outside the store's own folder", async () => {
    await mkdir(join(root, 'uploads/content-media/t2'), { recursive: true });
    await writeFile(join(root, 'uploads/content-media/t2/theirs.jpg'), await picture('rising'));
    const t = setup({
      row: { imagePath: '/uploads/content-media/t2/theirs.jpg' },
      details: { mediaUrl: 'https://graph-cdn/p.jpg', mediaType: 'image' },
      routes: { 'https://graph-cdn/p.jpg': { body: await picture('falling'), type: 'image/jpeg' } },
    });
    const out = await t.service.capture('t1', { type: 'story_reply', mediaId: 's1' });
    expect(out.url).toMatch(/^\/uploads\/content-media\/t1\//);
  });

  it("turns a video into one contact sheet of its four most different frames, about 1536 px wide", async () => {
    frames.mockResolvedValue(
      await Promise.all((['rising', 'rising', 'falling', 'stripes', 'split', 'checker', 'falling', 'rising'] as const).map(picture)),
    );
    const t = setup({
      details: { mediaUrl: 'https://graph-cdn/r.mp4', mediaType: 'video', productType: 'REELS', caption: 'Нова колекція' },
      routes: { 'https://graph-cdn/r.mp4': { body: MP4, type: 'video/mp4' } },
    });

    const out = await t.service.capture('t1', { type: 'post_share', mediaId: 'r1' });
    expect(out).toMatchObject({ image: 'video_frames', reel: true, caption: 'Нова колекція' });
    expect(out.url).toMatch(/-frames\.jpg$/);
    const meta = await sharp(join(root, out.url!)).metadata();
    expect(meta.width).toBe(1536);
    // Two rows of portrait frames.
    expect(meta.height).toBeGreaterThan(2 * 1.7 * 764);
    expect(t.content.saveUnlinkedMedia).toHaveBeenCalledWith('t1', 'r1', 'video', expect.objectContaining({ imagePath: out.url, productType: 'REELS' }), null);
  });

  it('keeps a video whose frames are all alike (a photo story with music) as one picture, matched like a picture', async () => {
    frames.mockResolvedValue(await Promise.all(Array.from({ length: 8 }, () => picture('stripes'))));
    const t = setup({ routes: { 'https://cdn/s.mp4': { body: MP4, type: 'video/mp4' } } });
    const out = await t.service.capture('t1', { type: 'story_reply', mediaId: 's1', sourceUrl: 'https://cdn/s.mp4' });
    expect(out.image).toBe('picture');
    // Not named as frames, so the copy kept for the next customer reads as a picture too.
    expect(out.url).not.toMatch(/-frames\.jpg$/);
    const meta = await sharp(join(root, out.url!)).metadata();
    expect([meta.width, meta.height]).toEqual([W, H]);
  });

  it('streams a video to a file instead of holding it, and takes no video over 50 MB', async () => {
    frames.mockResolvedValue(await Promise.all((['rising', 'falling'] as const).map(picture)));
    const t = setup({
      details: { mediaUrl: 'https://graph-cdn/v.mp4', mediaType: 'video' },
      routes: { 'https://graph-cdn/v.mp4': { body: MP4, type: 'video/mp4' } },
    });
    expect((await t.service.capture('t1', { type: 'story_reply', mediaId: 's1' })).image).toBe('video_frames');
    const [, options] = safeFetchMock.mock.calls.find(([url]) => url === 'https://graph-cdn/v.mp4')!;
    expect(options).toMatchObject({ maxBytes: 50 * 1024 * 1024, toFile: expect.any(String) });
    // ffmpeg read the downloaded file.
    expect(frames.mock.calls[0][0]).toBe(options!.toFile);
  });

  it('falls back to the cover when too many videos are waiting already', async () => {
    const releases: Array<(f: Buffer[]) => void> = [];
    frames.mockImplementation(() => new Promise((resolve) => releases.push(resolve)));
    const routes: Routes = { 'https://graph-cdn/cover.jpg': { body: await picture('split'), type: 'image/jpeg' } };
    for (let i = 0; i <= 8; i++) routes[`https://graph-cdn/v${i}.mp4`] = { body: MP4, type: 'video/mp4' };
    const t = setup({ routes });
    t.content.readMediaDetails.mockImplementation(async (_t, id) => ({
      details: { mediaUrl: `https://graph-cdn/${id}.mp4`, mediaType: 'video', ...(id === 'v8' && { thumbnailUrl: 'https://graph-cdn/cover.jpg' }) },
    }));

    // Two videos being read, six waiting.
    const busy = Array.from({ length: 8 }, (_, i) => t.service.capture('t1', { type: 'post_share', mediaId: `v${i}` }));
    await until(() => frames.mock.calls.length === 2);
    for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));

    const out = await t.service.capture('t1', { type: 'post_share', mediaId: 'v8' });
    expect(out.image).toBe('video_cover');
    expect(t.fetched).not.toContain('https://graph-cdn/v8.mp4');

    frames.mockResolvedValue([]);
    releases.forEach((release) => release([]));
    await Promise.all(busy);
  });

  it("falls back to the video's cover when its frames can't be taken, and doesn't keep the cover as the copy", async () => {
    frames.mockRejectedValue(new Error('ffmpeg died'));
    const t = setup({
      details: { mediaUrl: 'https://graph-cdn/v.mp4', thumbnailUrl: 'https://graph-cdn/cover.jpg', mediaType: 'video' },
      routes: {
        'https://graph-cdn/v.mp4': { body: MP4, type: 'video/mp4' },
        'https://graph-cdn/cover.jpg': { body: await picture('split'), type: 'image/jpeg' },
      },
    });
    const out = await t.service.capture('t1', { type: 'story_reply', mediaId: 's1' });
    expect(out.image).toBe('video_cover');
    expect(out.url).toMatch(/^\/uploads\/content-media\/t1\//);
    expect(t.content.saveUnlinkedMedia).toHaveBeenCalledWith('t1', 's1', 'story', expect.objectContaining({ imagePath: null }), null);
  });

  it("copies another account's post from the webhook's link and marks it, without recording it as the shop's", async () => {
    const t = setup({ details: null, routes: { 'https://cdn/theirs.jpg': { body: await picture('checker'), type: 'image/jpeg' } } });
    const out = await t.service.capture('t1', { type: 'post_share', mediaId: 'p9', sourceUrl: 'https://cdn/theirs.jpg', caption: 'Look' });
    expect(out).toMatchObject({ image: 'picture', foreign: true, caption: 'Look' });
    expect(t.content.saveUnlinkedMedia).not.toHaveBeenCalled();
    expect(t.content.saveContentImage).not.toHaveBeenCalled();
  });

  it("calls a shared post another account's only when Graph refuses it, never when we have its row", async () => {
    const routes = { 'https://cdn/p.jpg': { body: await picture('checker'), type: 'image/jpeg' } };
    const share = { type: 'post_share' as const, mediaId: 'p9', sourceUrl: 'https://cdn/p.jpg' };

    // The shop's post (we have its row) while Graph is briefly down.
    const known = setup({ row: { productId: null, imagePath: null, caption: 'Сукня' }, refused: false, routes });
    expect((await known.service.capture('t1', share)).foreign).toBeUndefined();
    expect(known.content.saveUnlinkedMedia).toHaveBeenCalled();

    // A post we don't know and Graph failed to read: not marked, and not kept as the shop's.
    const unsure = setup({ refused: false, routes });
    const out = await unsure.service.capture('t1', share);
    expect(out).toMatchObject({ image: 'picture' });
    expect(out.foreign).toBeUndefined();
    expect(unsure.content.saveUnlinkedMedia).not.toHaveBeenCalled();

    // Graph refused it: another account's.
    const refused = setup({ refused: true, routes });
    expect((await refused.service.capture('t1', share)).foreign).toBe(true);
  });

  it('leaves the caption alone when nothing can be copied, and never throws', async () => {
    const t = setup({ details: null, routes: { 'https://cdn/expired.jpg': 403 } });
    t.content.findByMediaId.mockRejectedValue(new Error('db down'));
    expect(await t.service.capture('t1', { type: 'post_share', mediaId: 'p9', sourceUrl: 'https://cdn/expired.jpg', caption: 'Сукня' })).toEqual({
      caption: 'Сукня',
      foreign: true,
    });
  });

  it('copies the same story once when several customers reply to it at the same time', async () => {
    const t = setup({ routes: { 'https://cdn/s.jpg': { body: await picture('rising'), type: 'image/jpeg' } } });
    const [a, b] = await Promise.all([
      t.service.capture('t1', { type: 'story_reply', mediaId: 's1', sourceUrl: 'https://cdn/s.jpg' }),
      t.service.capture('t1', { type: 'story_reply', mediaId: 's1', sourceUrl: 'https://cdn/s.jpg' }),
    ]);
    expect(a.url).toBe(b.url);
    expect(t.content.readMediaDetails).toHaveBeenCalledTimes(1);
  });

  describe('for a message', () => {
    it('writes the copy onto its attachment, and the turn waits for it', async () => {
      const t = setup({ routes: { 'https://cdn/s.jpg': { body: await picture('rising'), type: 'image/jpeg' } } });
      const attachments: MessageAttachment[] = [
        { type: 'customer_photo', mediaId: 'https://cdn/photo.jpg' },
        { type: 'story_reply', mediaId: 's1', sourceUrl: 'https://cdn/s.jpg' },
      ];
      t.service.startForMessage('t1', 'c1', 'm1', attachments);
      await t.service.prepare('t1', 'c1');

      expect(t.writes).toHaveLength(1);
      expect(t.writes[0]).toMatchObject({
        messageId: 'm1',
        index: '1',
        attachment: { type: 'story_reply', mediaId: 's1', sourceUrl: 'https://cdn/s.jpg', image: 'picture' },
      });
      expect(t.writes[0].attachment.url).toMatch(/^\/uploads\/content-media\/t1\//);
    });

    it("copies what the customer's new messages point at when nobody started it (a restart, the simulator)", async () => {
      const t = setup({ routes: { 'https://cdn/p.jpg': { body: await picture('rising'), type: 'image/jpeg' } } });
      t.dataSource.query.mockImplementationOnce(async () => [
        { id: 'm7', attachments: [{ type: 'post_share', mediaId: 'https://cdn/p.jpg' }] },
      ]);
      await t.service.prepare('t1', 'c1');
      expect(t.writes[0]).toMatchObject({ messageId: 'm7', index: '0', attachment: { image: 'picture', foreign: true } });

      // Tried once: the next turn doesn't start it again.
      t.dataSource.query.mockImplementationOnce(async () => [
        { id: 'm7', attachments: [{ type: 'post_share', mediaId: 'https://cdn/p.jpg' }] },
      ]);
      await t.service.prepare('t1', 'c1');
      expect(t.writes).toHaveLength(1);

      // Ten minutes on, it is tried again, even though nothing new was tried meanwhile.
      jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 11 * 60 * 1000);
      t.dataSource.query.mockImplementationOnce(async () => [
        { id: 'm7', attachments: [{ type: 'post_share', mediaId: 'https://cdn/p.jpg' }] },
      ]);
      await t.service.prepare('t1', 'c1');
      expect(t.writes).toHaveLength(2);
    });

    it("doesn't hold the turn past its wait; the copy lands on the message later", async () => {
      let release: (f: Buffer[]) => void = () => undefined;
      frames.mockImplementation(() => new Promise((resolve) => (release = resolve)));
      const t = setup({ routes: { 'https://cdn/s.mp4': { body: MP4, type: 'video/mp4' } } });
      t.service.startForMessage('t1', 'c1', 'm1', [{ type: 'story_reply', mediaId: 's1', sourceUrl: 'https://cdn/s.mp4' }]);

      const started = Date.now();
      await t.service.prepare('t1', 'c1', 50);
      expect(Date.now() - started).toBeLessThan(1000);
      expect(t.writes).toHaveLength(0);

      release(await Promise.all((['rising', 'falling'] as const).map(picture)));
      await until(() => t.writes.length > 0);
      expect(t.writes[0].attachment.image).toBe('video_frames');
      expect(t.content.saveUnlinkedMedia).toHaveBeenCalledWith('t1', 's1', 'story', expect.objectContaining({ imagePath: t.writes[0].attachment.url }), null);
    });

    it("puts the video's cover on the message while slow frames are still being made, then the sheet", async () => {
      jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
      let release: (f: Buffer[]) => void = () => undefined;
      frames.mockImplementation(() => new Promise((resolve) => (release = resolve)));
      const t = setup({
        details: { mediaUrl: 'https://graph-cdn/v.mp4', thumbnailUrl: 'https://graph-cdn/cover.jpg', mediaType: 'video' },
        routes: {
          'https://graph-cdn/v.mp4': { body: MP4, type: 'video/mp4' },
          'https://graph-cdn/cover.jpg': { body: await picture('split'), type: 'image/jpeg' },
        },
      });
      t.service.startForMessage('t1', 'c1', 'm1', [{ type: 'story_reply', mediaId: 's1' }]);
      await until(() => frames.mock.calls.length > 0);
      expect(t.fetched).not.toContain('https://graph-cdn/cover.jpg');

      jest.advanceTimersByTime(2_000);
      await until(() => t.writes.length > 0);
      expect(t.writes[0].attachment.image).toBe('video_cover');

      release(await Promise.all((['rising', 'falling'] as const).map(picture)));
      await until(() => t.writes.length > 1);
      expect(t.writes[1].attachment.image).toBe('video_frames');
    });

    it("doesn't let a cover that arrives after the frames replace them, or keep it", async () => {
      jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
      let release: (f: Buffer[]) => void = () => undefined;
      frames.mockImplementation(() => new Promise((resolve) => (release = resolve)));
      let coverArrives: () => void = () => undefined;
      const coverFile = { body: await picture('split'), type: 'image/jpeg' };
      const t = setup({
        details: { mediaUrl: 'https://graph-cdn/v.mp4', thumbnailUrl: 'https://graph-cdn/cover.jpg', mediaType: 'video' },
        routes: {
          'https://graph-cdn/v.mp4': { body: MP4, type: 'video/mp4' },
          'https://graph-cdn/cover.jpg': () => new Promise<File>((resolve) => (coverArrives = () => resolve(coverFile))),
        },
      });
      t.service.startForMessage('t1', 'c1', 'm1', [{ type: 'story_reply', mediaId: 's1' }]);
      await until(() => frames.mock.calls.length > 0);
      jest.advanceTimersByTime(2_000);
      await until(() => t.fetched.includes('https://graph-cdn/cover.jpg'));

      release(await Promise.all((['rising', 'falling'] as const).map(picture)));
      await until(() => t.writes.length > 0);
      coverArrives();
      for (let i = 0; i < 200; i++) await new Promise((r) => setImmediate(r));

      expect(t.writes.map((w) => w.attachment.image)).toEqual(['video_frames']);
      // Only the sheet was saved: the late cover never became a file.
      expect(await readdir(join(root, 'uploads/content-media/t1'))).toEqual([expect.stringMatching(/-frames\.jpg$/)]);
    });

    it("logs a failed write instead of leaving a rejection that would end the process, and still writes the result", async () => {
      jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
      const unhandled = jest.fn();
      process.on('unhandledRejection', unhandled);
      try {
        let release: (f: Buffer[]) => void = () => undefined;
        frames.mockImplementation(() => new Promise((resolve) => (release = resolve)));
        const t = setup({
          details: { mediaUrl: 'https://graph-cdn/v.mp4', thumbnailUrl: 'https://graph-cdn/cover.jpg', mediaType: 'video' },
          routes: {
            'https://graph-cdn/v.mp4': { body: MP4, type: 'video/mp4' },
            'https://graph-cdn/cover.jpg': { body: await picture('split'), type: 'image/jpeg' },
          },
        });
        const warn = jest.spyOn((t.service as unknown as { logger: { warn: (m: string) => void } }).logger, 'warn').mockImplementation(() => undefined);
        // The stand-in cover's write fails (the database is briefly down); the next one works.
        const query = t.dataSource.query.getMockImplementation()!;
        t.dataSource.query.mockImplementationOnce(async () => {
          throw new Error('connection terminated');
        });
        t.dataSource.query.mockImplementation(query);

        t.service.startForMessage('t1', 'c1', 'm1', [{ type: 'story_reply', mediaId: 's1' }]);
        await until(() => frames.mock.calls.length > 0);
        jest.advanceTimersByTime(2_000);
        await until(() => warn.mock.calls.some(([m]) => /not written: connection terminated/.test(m)));

        release(await Promise.all((['rising', 'falling'] as const).map(picture)));
        await until(() => t.writes.length > 0);
        for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
        expect(t.writes.map((w) => w.attachment.image)).toEqual(['video_frames']);
        expect(unhandled).not.toHaveBeenCalled();
      } finally {
        process.off('unhandledRejection', unhandled);
      }
    });
  });

  describe('matchCatalogImage', () => {
    async function withCatalog(rows: Array<{ product_id: string; color: string | null; image: keyof typeof PATTERNS }>) {
      const t = setup();
      const hashes = new ImageHashService();
      const catalog = await Promise.all(
        rows.map(async (r) => ({ product_id: r.product_id, color: r.color, phash: await hashes.hashFromBuffer(await picture(r.image)) })),
      );
      t.dataSource.query.mockImplementation(async () => catalog);
      await mkdir(join(root, 'uploads/content-media/t1'), { recursive: true });
      await writeFile(join(root, 'uploads/content-media/t1/p.jpg'), await picture('stripes'));
      return t.service.matchCatalogImage('t1', '/uploads/content-media/t1/p.jpg');
    }

    it("finds the product whose catalog photo it is, even stored for two of its colours", async () => {
      expect(await withCatalog([
        { product_id: 'a', color: 'Білий', image: 'stripes' },
        { product_id: 'a', color: 'Чорний', image: 'stripes' },
        { product_id: 'b', color: null, image: 'rising' },
      ])).toEqual({ productId: 'a', color: null });
    });

    it('gives nothing on a tie between products or when no photo is close', async () => {
      expect(await withCatalog([
        { product_id: 'a', color: null, image: 'stripes' },
        { product_id: 'b', color: null, image: 'stripes' },
      ])).toBeNull();
      expect(await withCatalog([{ product_id: 'b', color: null, image: 'rising' }])).toBeNull();
    });
  });
});

/** Let real I/O (files, sharp) run until `done` holds, without relying on timers (they may be faked). */
async function until(done: () => boolean): Promise<void> {
  for (let i = 0; i < 20_000 && !done(); i++) await new Promise((r) => setImmediate(r));
  if (!done()) throw new Error('condition never met');
}
