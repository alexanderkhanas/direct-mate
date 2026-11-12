import { EventEmitter } from 'events';
import { mkdtemp, readFile, rm } from 'fs/promises';
import * as http from 'http';
import { tmpdir } from 'os';
import { join } from 'path';
import { Readable } from 'stream';
import { checkUrl, isBlockedAddress, safeFetch, TooLargeError, UnsafeUrlError } from './safe-fetch';

/** `http.get` answered by a fake server sending `chunks`; `sent` counts the bytes it was asked for. */
function serve(status: number, headers: Record<string, string>, chunks: Buffer[]) {
  const sent = { bytes: 0 };
  jest.spyOn(http, 'get').mockImplementation(((_url: URL, _options: unknown, callback: (res: http.IncomingMessage) => void) => {
    let i = 0;
    const res = new Readable({
      read() {
        if (i >= chunks.length) return void this.push(null);
        sent.bytes += chunks[i].length;
        this.push(chunks[i++]);
      },
    });
    Object.assign(res, { statusCode: status, headers });
    const req = Object.assign(new EventEmitter(), {
      destroy(err?: Error) {
        res.destroy();
        if (err) req.emit('error', err);
        req.emit('close');
      },
    });
    setImmediate(() => callback(res as unknown as http.IncomingMessage));
    return req;
  }) as never);
  return sent;
}

describe('safeFetch', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.20.0.5',
    '192.168.1.10',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '::1',
    'fe80::1',
    'fd00::5',
    '::ffff:127.0.0.1',
    '::ffff:10.0.0.1',
  ])('treats %s as not public', (address) => {
    expect(isBlockedAddress(address)).toBe(true);
  });

  it.each(['8.8.8.8', '151.101.1.69', '2606:4700::6810:84e5'])('treats %s as public', (address) => {
    expect(isBlockedAddress(address)).toBe(false);
  });

  it.each([
    'file:///etc/passwd',
    'ftp://example.com/feed.xml',
    'http://example.com:8080/feed.xml',
    'https://user:pass@example.com/feed.xml',
    'http://127.0.0.1/feed.xml',
    'http://[::1]/feed.xml',
    '/uploads/a.jpg',
  ])('refuses %s before connecting', (url) => {
    expect(() => checkUrl(url)).toThrow(UnsafeUrlError);
  });

  it('accepts a normal https link', () => {
    expect(checkUrl('https://shop.example.com/feed.xml?x=1').hostname).toBe('shop.example.com');
  });

  it('refuses a host name that resolves to a private address', async () => {
    await expect(safeFetch('http://localhost/feed.xml')).rejects.toThrow(/not public/);
  });
});

describe('safeFetch body', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'safe-fetch-'));
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    await rm(dir, { recursive: true, force: true });
  });

  it('returns the body, or streams it into a file and returns none', async () => {
    serve(200, { 'content-type': 'video/mp4' }, [Buffer.from('ab'), Buffer.from('cd')]);
    expect((await safeFetch('http://cdn.example/v.mp4')).body.toString()).toBe('abcd');

    serve(200, { 'content-type': 'video/mp4' }, [Buffer.from('ab'), Buffer.from('cd')]);
    const file = join(dir, 'v.mp4');
    const res = await safeFetch('http://cdn.example/v.mp4', { toFile: file });
    expect([res.status, res.headers['content-type'], res.body.length]).toEqual([200, 'video/mp4', 0]);
    expect((await readFile(file)).toString()).toBe('abcd');
  });

  it('stops writing a file past the cap, even without a Content-Length', async () => {
    const sent = serve(200, {}, Array.from({ length: 1000 }, () => Buffer.alloc(1024)));
    await expect(safeFetch('http://cdn.example/endless', { toFile: join(dir, 'f'), maxBytes: 10_000 })).rejects.toBeInstanceOf(TooLargeError);
    expect(sent.bytes).toBeLessThan(100_000);
  });

  it('refuses by Content-Length, or by what the caller sees in the headers, before reading the body', async () => {
    const big = serve(200, { 'content-length': '5000000' }, [Buffer.alloc(1024)]);
    await expect(safeFetch('http://cdn.example/big', { maxBytes: 1_000_000 })).rejects.toThrow(/larger than/);
    expect(big.bytes).toBe(0);

    const video = serve(200, { 'content-type': 'video/mp4' }, [Buffer.alloc(1024)]);
    const onHeaders = (_status: number, headers: Record<string, string>) => {
      if (headers['content-type'].startsWith('video/')) throw new Error('a video, not a picture');
    };
    await expect(safeFetch('http://cdn.example/cover', { onHeaders })).rejects.toThrow('a video, not a picture');
    expect(video.bytes).toBe(0);
  });
});
