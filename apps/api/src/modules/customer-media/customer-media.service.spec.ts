import { mkdtemp, rm, stat } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import sharp = require('sharp');
import { CustomerMediaService } from './customer-media.service';

describe('CustomerMediaService', () => {
  const media = new CustomerMediaService();
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'customer-media-'));
    jest.spyOn(process, 'cwd').mockReturnValue(root);
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await rm(root, { recursive: true, force: true });
  });

  const photo = (width: number, height: number) =>
    sharp({ create: { width, height, channels: 3, background: '#336699' } }).png().toBuffer();

  it('keeps a JPEG copy no larger than 1024 px on the long side, and loads it back', async () => {
    const attachment = await media.storeFromBuffer('t1', await photo(2000, 1500));

    expect(attachment.url).toMatch(/^\/uploads\/customer-media\/t1\/[0-9a-f-]{36}\.jpg$/);
    expect(attachment).toEqual({ type: 'customer_photo', mediaId: attachment.url, url: attachment.url });
    const loaded = await media.load(attachment.url!);
    const meta = await sharp(Buffer.from(loaded!.data)).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(['jpeg', 1024, 768]);
  });

  it("doesn't enlarge a small photo", async () => {
    const attachment = await media.storeFromBuffer('t1', await photo(400, 300));
    const meta = await sharp(Buffer.from((await media.load(attachment.url!))!.data)).metadata();
    expect([meta.width, meta.height]).toEqual([400, 300]);
  });

  it('records why a photo has no copy instead of throwing', async () => {
    expect(await media.storeFromBuffer('t1', Buffer.from('not an image'))).toEqual({
      type: 'customer_photo',
      mediaId: 'upload',
      error: 'unreadable',
    });

    jest.spyOn(global, 'fetch').mockResolvedValue(new Response('gone', { status: 404 }));
    expect(await media.storeFromUrl('t1', 'https://cdn.example/expired.jpg')).toEqual({
      type: 'customer_photo',
      mediaId: 'https://cdn.example/expired.jpg',
      error: 'download_failed',
    });
  });

  it('downloads a photo from its URL and keeps the URL as the media id', async () => {
    const body = await photo(1500, 1500);
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response(new Uint8Array(body), { status: 200 }));
    const attachment = await media.storeFromUrl('t1', 'https://cdn.example/a.jpg');

    expect(attachment.mediaId).toBe('https://cdn.example/a.jpg');
    expect(attachment.url).toMatch(/^\/uploads\/customer-media\/t1\//);
  });

  it('passes other attachments through and recognises its own copies', async () => {
    expect(await media.attachmentFor('t1', { type: 'story_reply', mediaId: 's1' })).toEqual({
      type: 'story_reply',
      mediaId: 's1',
    });
    const stored = await media.storeFromBuffer('t1', await photo(10, 10));
    expect(await media.attachmentFor('t1', { type: 'customer_photo', mediaId: stored.url! })).toEqual({
      type: 'customer_photo',
      mediaId: stored.url,
      url: stored.url,
    });
  });

  it('opens and deletes only its own copies', async () => {
    expect(await media.load('/uploads/customer-media/../../package.json')).toBeNull();
    expect(await media.load('/uploads/size-chart.png')).toBeNull();
    expect(await media.load('https://cdn.example/a.jpg')).toBeNull();

    const stored = await media.storeFromBuffer('t1', await photo(10, 10));
    await media.remove([stored.url!, '/uploads/size-chart.png']);
    await expect(stat(join(root, stored.url!))).rejects.toThrow();
    expect(await media.load(stored.url!)).toBeNull();
  });
});
