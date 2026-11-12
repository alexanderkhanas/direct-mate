import * as dns from 'dns';
import { createWriteStream } from 'fs';
import * as http from 'http';
import * as https from 'https';
import { BlockList, isIP, type LookupFunction } from 'net';
import { Transform } from 'stream';
import { pipeline } from 'stream/promises';
import * as zlib from 'zlib';

/**
 * GET for URLs a store owner gives us (product feeds, website pages, feed
 * images). The server fetching them sits next to Postgres, n8n and the
 * analytics containers, so an owner must not be able to point it at them.
 *
 * - http(s) only, on the default ports, with no credentials in the URL.
 * - Every address a host resolves to must be public. The check runs inside
 *   the socket's DNS lookup, so the address that is checked is the one that
 *   is connected to: a name can't resolve to a public address for the check
 *   and a private one for the connection.
 * - Redirects are followed by hand, each one checked the same way.
 * - One timeout for the whole request, and a size cap on the body.
 * - A large body (a video) can go straight to a file (`toFile`), so it never
 *   sits in memory.
 */

export class UnsafeUrlError extends Error {}

/** The body is over `maxBytes` (by its Content-Length, or once it has passed the cap). */
export class TooLargeError extends Error {}

export interface SafeFetchOptions {
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  headers?: Record<string, string>;
  /** Write the body to this file instead of returning it (`body` comes back empty). */
  toFile?: string;
  /** Sees the final response's status and headers before its body is read; throwing stops the download. */
  onHeaders?: (status: number, headers: Record<string, string>) => void;
}

export interface SafeFetchResult {
  status: number;
  /** Lower-cased header names; repeated headers joined with ", ". */
  headers: Record<string, string>;
  body: Buffer;
  /** After redirects. */
  url: string;
}

const DEFAULTS = { timeoutMs: 20_000, maxBytes: 50 * 1024 * 1024, maxRedirects: 5 };

const BLOCKED = new BlockList();
for (const [net, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10], // carrier-grade NAT
  ['127.0.0.0', 8],
  ['169.254.0.0', 16], // link-local, incl. cloud metadata
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved, incl. broadcast
] as const) {
  BLOCKED.addSubnet(net, prefix, 'ipv4');
}
for (const [net, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['64:ff9b::', 96], // NAT64 can reach IPv4 private ranges
  ['100::', 64],
  ['2001:db8::', 32],
  ['fc00::', 7], // unique local
  ['fe80::', 10], // link-local
  ['ff00::', 8], // multicast
] as const) {
  BLOCKED.addSubnet(net, prefix, 'ipv6');
}

/** True for loopback, private, link-local, multicast and other non-public addresses. */
export function isBlockedAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return BLOCKED.check(address, 'ipv4');
  if (family === 6) {
    const mapped = address.toLowerCase().match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return BLOCKED.check(mapped[1], 'ipv4');
    return BLOCKED.check(address, 'ipv6');
  }
  return true;
}

/** The URL if it may be fetched at all (scheme, port, no credentials); the host is checked at connect time. */
export function checkUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeUrlError(`Not a valid absolute URL: ${raw}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new UnsafeUrlError(`Only http and https links are allowed: ${raw}`);
  }
  if (url.port && url.port !== '80' && url.port !== '443') {
    throw new UnsafeUrlError(`Only the standard ports are allowed: ${raw}`);
  }
  if (url.username || url.password) throw new UnsafeUrlError(`Links with a login in them are not allowed: ${raw}`);
  const literal = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(literal) && isBlockedAddress(literal)) {
    throw new UnsafeUrlError(`This address is not public: ${raw}`);
  }
  return url;
}

/** A DNS lookup that fails for hosts resolving to any non-public address. */
const publicOnlyLookup: LookupFunction = (hostname, options, callback) => {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, '', 4);
    const list = addresses as dns.LookupAddress[];
    const blocked = list.find((a) => isBlockedAddress(a.address));
    if (list.length === 0 || blocked) {
      return callback(new UnsafeUrlError(`${hostname} resolves to an address that is not public`), '', 4);
    }
    if (options.all) return (callback as unknown as (e: null, a: dns.LookupAddress[]) => void)(null, list);
    callback(null, list[0].address, list[0].family);
  });
};

export async function safeFetch(rawUrl: string, options: SafeFetchOptions = {}): Promise<SafeFetchResult> {
  const opts = { ...DEFAULTS, ...options };
  const deadline = Date.now() + opts.timeoutMs;
  let url = checkUrl(rawUrl);
  for (let hop = 0; ; hop++) {
    const res = await request(url, opts, deadline);
    const location = res.headers.location;
    if (res.status >= 300 && res.status < 400 && location) {
      if (hop >= opts.maxRedirects) throw new UnsafeUrlError(`Too many redirects from ${rawUrl}`);
      url = checkUrl(new URL(location, url).toString());
      continue;
    }
    return { ...res, url: url.toString() };
  }
}

function request(
  url: URL,
  opts: typeof DEFAULTS & SafeFetchOptions,
  deadline: number,
): Promise<Omit<SafeFetchResult, 'url'>> {
  const client = url.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return reject(new Error(`Timed out fetching ${url}`));
    const req = client.get(
      url,
      {
        lookup: publicOnlyLookup,
        headers: { 'user-agent': 'DirectMate/1.0 (+https://directmate.app)', 'accept-encoding': 'gzip, deflate, br', ...opts.headers },
        timeout: remaining,
      },
      (res) => {
        const headers: Record<string, string> = {};
        for (const [name, value] of Object.entries(res.headers)) {
          if (value !== undefined) headers[name.toLowerCase()] = Array.isArray(value) ? value.join(', ') : value;
        }
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400) {
          res.resume();
          return resolve({ status, headers, body: Buffer.alloc(0) });
        }
        const tooLarge = () => new TooLargeError(`${url} is larger than ${Math.round(opts.maxBytes / 1024 / 1024)} MB`);
        try {
          opts.onHeaders?.(status, headers);
          if (Number(headers['content-length'] ?? 0) > opts.maxBytes) throw tooLarge();
        } catch (err) {
          req.destroy(err as Error);
          return;
        }
        const encoding = headers['content-encoding'];
        const stream =
          encoding === 'gzip' ? res.pipe(zlib.createGunzip())
          : encoding === 'deflate' ? res.pipe(zlib.createInflate())
          : encoding === 'br' ? res.pipe(zlib.createBrotliDecompress())
          : res;
        let size = 0;
        if (opts.toFile) {
          const cap = new Transform({
            transform(chunk: Buffer, _encoding, done) {
              size += chunk.length;
              done(size > opts.maxBytes ? tooLarge() : null, chunk);
            },
          });
          pipeline(stream, cap, createWriteStream(opts.toFile)).then(
            () => resolve({ status, headers, body: Buffer.alloc(0) }),
            (err: Error) => {
              req.destroy(err);
              reject(err);
            },
          );
          return;
        }
        const chunks: Buffer[] = [];
        stream.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > opts.maxBytes) {
            req.destroy(tooLarge());
            return;
          }
          chunks.push(chunk);
        });
        stream.on('end', () => resolve({ status, headers, body: Buffer.concat(chunks) }));
        stream.on('error', reject);
      },
    );
    const timer = setTimeout(() => req.destroy(new Error(`Timed out fetching ${url}`)), remaining);
    req.on('timeout', () => req.destroy(new Error(`Timed out fetching ${url}`)));
    req.on('error', reject);
    req.on('close', () => clearTimeout(timer));
  });
}
