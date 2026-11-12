import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import sharp = require('sharp');
import { safeFetch, SafeFetchOptions, TooLargeError, UnsafeUrlError } from '../../common/safe-fetch';
import {
  CONTENT_FOLDER,
  CustomerMediaService,
  downloadMedia,
  downloadToFile,
  isContentCopy,
  MediaFailure,
} from './customer-media.service';

jest.mock('../../common/safe-fetch', () => ({ ...jest.requireActual('../../common/safe-fetch'), safeFetch: jest.fn() }));
const safeFetchMock = safeFetch as jest.MockedFunction<typeof safeFetch>;

/** safeFetch answering with this status, type and body: the headers hook first, then the body to a file or back. */
function respond(status: number, body: Buffer, type = 'image/jpeg') {
  return async (url: string, options: SafeFetchOptions = {}) => {
    const headers = { 'content-type': type };
    options.onHeaders?.(status, headers);
    if (options.toFile) {
      await writeFile(options.toFile, body);
      return { status, headers, body: Buffer.alloc(0), url };
    }
    return { status, headers, body, url };
  };
}

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

    safeFetchMock.mockImplementation(respond(404, Buffer.from('gone')));
    expect(await media.storeFromUrl('t1', 'https://cdn.example/expired.jpg')).toEqual({
      type: 'customer_photo',
      mediaId: 'https://cdn.example/expired.jpg',
      error: 'download_failed',
    });
  });

  it('downloads a photo from its URL and keeps the URL as the media id', async () => {
    const body = await photo(1500, 1500);
    safeFetchMock.mockImplementation(respond(200, body));
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

  it("loads copies of stories and posts for the agent, but never deletes them with a conversation", async () => {
    const url = await media.saveImage('t1', await photo(10, 10), { folder: CONTENT_FOLDER, suffix: '-frames' });
    expect(url).toMatch(/^\/uploads\/content-media\/t1\/[0-9a-f-]{36}-frames\.jpg$/);
    expect(await media.load(url)).not.toBeNull();

    // The same story's copy serves every customer who replies to it.
    await media.remove([url]);
    expect(await media.load(url)).not.toBeNull();
  });

  it("knows a copy by where its file is, so '..' can't reach another folder or store", async () => {
    await mkdir(join(root, 'uploads/size-charts'), { recursive: true });
    await writeFile(join(root, 'uploads/size-charts/chart.png'), await photo(10, 10));
    const own = await media.storeFromBuffer('t1', await photo(10, 10));
    const content = await media.saveImage('t1', await photo(10, 10), { folder: CONTENT_FOLDER });

    expect(isContentCopy(content)).toBe(true);
    expect(isContentCopy(content, 't1')).toBe(true);
    expect(isContentCopy(content, 't2')).toBe(false);
    expect(isContentCopy(own.url!.replace('/uploads/customer-media/', '/uploads/content-media/../customer-media/'))).toBe(false);
    expect(isContentCopy('/uploads/content-media/t1/../../size-charts/chart.png')).toBe(false);
    expect(isContentCopy('/uploads/content-media/chart.png')).toBe(false);
    expect(await media.load('/uploads/content-media/t1/../../size-charts/chart.png')).toBeNull();

    // A customer photo's path is held to its folder the same way: deleting a conversation can't delete other files.
    await media.remove(['/uploads/customer-media/../size-charts/chart.png', content.replace('/uploads/content-media/', '/uploads/customer-media/../content-media/')]);
    expect(await stat(join(root, 'uploads/size-charts/chart.png'))).toBeTruthy();
    expect(await media.load(content)).not.toBeNull();
  });
});

describe('downloadMedia', () => {
  afterEach(() => jest.restoreAllMocks());
  beforeEach(() => safeFetchMock.mockReset());

  it('returns the bytes with their content type, through safeFetch with a timeout and a size cap', async () => {
    safeFetchMock.mockImplementation(respond(200, Buffer.from([1, 2, 3]), 'video/mp4; codecs=avc1'));
    const file = await downloadMedia('https://cdn.example/v.mp4');
    expect([...file.body]).toEqual([1, 2, 3]);
    expect(file.contentType).toBe('video/mp4');
    expect(safeFetchMock.mock.calls[0][1]).toMatchObject({ timeoutMs: 15_000, maxBytes: 20 * 1024 * 1024 });
  });

  it("doesn't retry a file over the cap or a link to a private address", async () => {
    safeFetchMock.mockRejectedValue(new TooLargeError('https://cdn.example/big is larger than 20 MB'));
    const tooLarge = await downloadMedia('https://cdn.example/big').catch((err: unknown) => err);
    expect(tooLarge).toBeInstanceOf(MediaFailure);
    expect((tooLarge as MediaFailure).reason).toBe('too_large');
    expect(safeFetchMock).toHaveBeenCalledTimes(1);

    safeFetchMock.mockReset();
    safeFetchMock.mockRejectedValue(new UnsafeUrlError('169.254.169.254 is not public'));
    const refused = await downloadMedia('http://169.254.169.254/latest').catch((err: unknown) => err);
    expect((refused as MediaFailure).reason).toBe('download_failed');
    expect(safeFetchMock).toHaveBeenCalledTimes(1);
  });

  it('stops at the headers when a picture was wanted and the link is a video', async () => {
    safeFetchMock.mockImplementation(respond(200, Buffer.alloc(10), 'video/mp4'));
    const failure = await downloadMedia('https://cdn.example/cover', { refuseVideo: true }).catch((err: unknown) => err);
    expect((failure as MediaFailure).reason).toBe('unreadable');
    expect(safeFetchMock).toHaveBeenCalledTimes(1);
  });

  it('streams a download into a file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'download-'));
    try {
      safeFetchMock.mockImplementation(respond(200, Buffer.from('ftyp video bytes'), 'video/mp4'));
      const file = join(dir, 'v');
      expect(await downloadToFile('https://cdn.example/v.mp4', file, { maxBytes: 50 })).toEqual({ contentType: 'video/mp4' });
      expect(safeFetchMock.mock.calls[0][1]).toMatchObject({ toFile: file, maxBytes: 50 });
      expect((await readFile(file)).toString()).toBe('ftyp video bytes');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
