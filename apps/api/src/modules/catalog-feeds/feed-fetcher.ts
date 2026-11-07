import { safeFetch, UnsafeUrlError } from '../../common/safe-fetch';
import type { FeedFormat } from './feed-normalize';

export class FeedError extends Error {
  constructor(
    /** For the admin: what went wrong, in a code it translates. */
    readonly code: 'unreachable' | 'not_public' | 'sheet_not_shared' | 'unknown_format' | 'too_large' | 'unsafe_url' | 'http_error',
    message: string,
  ) {
    super(message);
  }
}

export interface FetchedFeed {
  /** False when the server answered 304: nothing changed since `etag` / `lastModified`. */
  changed: boolean;
  format: FeedFormat | null;
  body: string;
  etag: string | null;
  lastModified: string | null;
  /** The link actually fetched (a Google Sheet link becomes its CSV export). */
  url: string;
}

const MAX_FEED_BYTES = 50 * 1024 * 1024;

/**
 * A Google Sheet's sharing link → its CSV export. The sheet must be shared
 * «anyone with the link can view» or published; otherwise Google answers with
 * its sign-in page, which is reported as `sheet_not_shared`.
 */
export function feedUrl(raw: string): string {
  const url = raw.trim();
  const published = url.match(/docs\.google\.com\/spreadsheets\/d\/e\/([\w-]+)/);
  if (published) return `https://docs.google.com/spreadsheets/d/e/${published[1]}/pub?output=csv${gidParam(url)}`;
  const sheet = url.match(/docs\.google\.com\/spreadsheets\/d\/([\w-]+)/);
  if (sheet) return `https://docs.google.com/spreadsheets/d/${sheet[1]}/export?format=csv${gidParam(url)}`;
  return url;
}

function gidParam(url: string): string {
  const gid = url.match(/[#&?]gid=(\d+)/)?.[1];
  return gid ? `&gid=${gid}` : '';
}

export async function fetchFeed(
  rawUrl: string,
  previous: { etag?: string | null; lastModified?: string | null } = {},
): Promise<FetchedFeed> {
  const url = feedUrl(rawUrl);
  const headers: Record<string, string> = { accept: 'application/xml, text/xml, text/csv, */*' };
  if (previous.etag) headers['if-none-match'] = previous.etag;
  if (previous.lastModified) headers['if-modified-since'] = previous.lastModified;

  let res;
  try {
    res = await safeFetch(url, { headers, maxBytes: MAX_FEED_BYTES, timeoutMs: 60_000 });
  } catch (err) {
    if (err instanceof UnsafeUrlError) throw new FeedError('unsafe_url', err.message);
    const message = (err as Error).message;
    if (/larger than/.test(message)) throw new FeedError('too_large', message);
    throw new FeedError('unreachable', message);
  }
  const meta = { etag: res.headers.etag ?? null, lastModified: res.headers['last-modified'] ?? null, url: res.url };
  if (res.status === 304) return { changed: false, format: null, body: '', ...meta };
  if (res.status === 401 || res.status === 403) throw new FeedError('not_public', `The link answered ${res.status}`);
  if (res.status >= 400) throw new FeedError('http_error', `The link answered ${res.status}`);

  const body = decode(res.body, res.headers['content-type']);
  const format = detectFormat(body, res.headers['content-type']);
  if (!format) {
    if (/docs\.google\.com/.test(url) && /<html/i.test(body.slice(0, 2000))) {
      throw new FeedError('sheet_not_shared', 'Google returned a sign-in page instead of the sheet');
    }
    throw new FeedError('unknown_format', 'Not a Google Merchant feed, a YML feed or a CSV sheet');
  }
  if (format !== 'sheet' && /<!ENTITY/i.test(body.slice(0, 10_000))) {
    // Entity declarations are how XML "bombs" expand; no product feed needs them.
    throw new FeedError('unknown_format', 'The XML declares entities, which feeds never need');
  }
  return { changed: true, format, body, ...meta };
}

export function detectFormat(body: string, contentType?: string): FeedFormat | null {
  const head = body.slice(0, 4000).trimStart();
  if (/<yml_catalog[\s>]/i.test(head) || /<shop[\s>][\s\S]*<offers[\s>]/i.test(head)) return 'yml';
  if (/<(rss|feed)[\s>]/i.test(head) && /base\.google\.com\/ns\/1\.0/i.test(head)) return 'gmc';
  if (head.startsWith('<')) return null;
  if (/text\/csv/i.test(contentType ?? '') || /[,;]/.test(head.split('\n')[0] ?? '')) return 'sheet';
  return null;
}

/** UTF-8 unless the XML declaration or the header says otherwise (old YML exports are often windows-1251). */
function decode(bytes: Buffer, contentType?: string): string {
  const declared =
    bytes.subarray(0, 200).toString('latin1').match(/encoding=["']([\w-]+)["']/i)?.[1] ??
    contentType?.match(/charset=([\w-]+)/i)?.[1] ??
    'utf-8';
  try {
    return new TextDecoder(declared.toLowerCase()).decode(bytes);
  } catch {
    return bytes.toString('utf8');
  }
}
