import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { mkdir, readFile, unlink, writeFile } from 'fs/promises';
import { dirname, join, relative, sep } from 'path';
import sharp = require('sharp');
import { safeFetch, TooLargeError, UnsafeUrlError } from '../../common/safe-fetch';
import { uploadPath, uploadsRoot } from '../../common/uploads';
import type { MessageAttachment } from '../conversations/entities/message.entity';

/** Long side of our copy. A phone photo drops from ~1,850 to ~1,000 input tokens per model call; text in a screenshot stays readable. */
export const MAX_SIDE = 1024;
/** Bigger sources are refused rather than downloaded. Everything smaller is shrunk, so the model never sees a large file. */
const MAX_SOURCE_BYTES = 20 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 15_000;
const DOWNLOAD_ATTEMPTS = 2;
const FOLDER = 'customer-media';
/** Stories', posts' and reels' images (`ContentMediaService`). Shared by every conversation about that content, so never deleted with one. */
export const CONTENT_FOLDER = 'content-media';

export interface LoadedImage {
  data: Uint8Array;
  mediaType: string;
}

export interface Downloaded {
  body: Buffer;
  /** The response's Content-Type, lower case, without parameters; '' when missing. */
  contentType: string;
}

export interface DownloadOptions {
  maxBytes?: number;
  timeoutMs?: number;
  attempts?: number;
  /** Stop at the headers when the response is a video (a cover or a picture was wanted). */
  refuseVideo?: boolean;
}

type Failure = NonNullable<MessageAttachment['error']>;

export class MediaFailure extends Error {
  constructor(readonly reason: Failure, detail: string) {
    super(detail);
  }
}

/**
 * Our copy of every photo a customer sends.
 *
 * Instagram's photo links expire within days, and the agent re-reads a
 * conversation's photos on every turn, so each one is saved when it arrives:
 * shrunk to 1024 px on the long side, re-encoded as JPEG (which also drops
 * EXIF, location included), under `uploads/customer-media/<tenant>/`. The
 * file name is a random UUID; the folder is served like the rest of
 * `uploads/`, so a copy is reachable only by someone who has its URL.
 *
 * Never throws on a bad photo: the attachment carries the reason instead, and
 * the agent asks the customer to send it again.
 *
 * Copies of stories, posts and reels go through the same download and resize
 * (`downloadMedia`, or `downloadToFile` for a video; `saveImage`), into
 * `uploads/content-media/`. Every download goes through `safeFetch`.
 */
@Injectable()
export class CustomerMediaService {
  private readonly logger = new Logger(CustomerMediaService.name);

  /** The attachment to save on an inbound message, with our copy of a customer's photo. */
  async attachmentFor(tenantId: string, ref: { type: string; mediaId: string }): Promise<MessageAttachment> {
    const type = ref.type as MessageAttachment['type'];
    if (type !== 'customer_photo') return { type, mediaId: ref.mediaId };
    if (isOwnCopy(ref.mediaId)) return { type, mediaId: ref.mediaId, url: ref.mediaId };
    return this.storeFromUrl(tenantId, ref.mediaId);
  }

  async storeFromUrl(tenantId: string, sourceUrl: string): Promise<MessageAttachment> {
    try {
      const { body } = await downloadMedia(sourceUrl);
      return { type: 'customer_photo', mediaId: sourceUrl, url: await this.saveImage(tenantId, body) };
    } catch (err) {
      return this.failed(sourceUrl, err);
    }
  }

  /** A photo uploaded straight to us (the admin console); its own URL becomes the media id. */
  async storeFromBuffer(tenantId: string, source: Buffer): Promise<MessageAttachment> {
    try {
      if (source.length > MAX_SOURCE_BYTES) throw new MediaFailure('too_large', `${source.length} bytes`);
      const url = await this.saveImage(tenantId, source);
      return { type: 'customer_photo', mediaId: url, url };
    } catch (err) {
      return this.failed('upload', err);
    }
  }

  /** The bytes of our copy (a customer's photo or a story's, post's or reel's image), or null when it is gone or the URL isn't one of ours. */
  async load(url: string): Promise<LoadedImage | null> {
    const file = isOwnCopy(url) || isContentCopy(url) ? uploadPath(url) : null;
    if (!file) return null;
    try {
      return { data: new Uint8Array(await readFile(file)), mediaType: 'image/jpeg' };
    } catch (err) {
      this.logger.warn(`Customer photo ${url} could not be loaded: ${err instanceof Error ? err.message : err}`);
      return null;
    }
  }

  /** Delete our copies of customer photos, e.g. with the conversation they belong to. Other URLs are ignored. */
  async remove(urls: string[]): Promise<void> {
    for (const url of urls) {
      const file = isOwnCopy(url) ? uploadPath(url) : null;
      if (!file) continue;
      await unlink(file).catch((err: NodeJS.ErrnoException) => {
        if (err.code !== 'ENOENT') this.logger.warn(`Could not delete ${url}: ${err.message}`);
      });
    }
  }

  /**
   * Save an image (bytes, or a file's path) as our JPEG copy and return its
   * URL: no larger than `maxSide`, EXIF dropped, transparency on white.
   * Throws `MediaFailure` ('unreadable') when it isn't an image.
   */
  async saveImage(
    tenantId: string,
    source: Buffer | string,
    opts: { folder?: string; maxSide?: number; suffix?: string } = {},
  ): Promise<string> {
    const maxSide = opts.maxSide ?? MAX_SIDE;
    let jpeg: Buffer;
    try {
      jpeg = await sharp(source)
        .rotate()
        .resize({ width: maxSide, height: maxSide, fit: 'inside', withoutEnlargement: true })
        .flatten({ background: '#ffffff' })
        .jpeg({ quality: 82 })
        .toBuffer();
    } catch (err) {
      throw new MediaFailure('unreadable', err instanceof Error ? err.message : String(err));
    }
    const relative = join(opts.folder ?? FOLDER, tenantId, `${randomUUID()}${opts.suffix ?? ''}.jpg`);
    const file = join(uploadsRoot(), relative);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, jpeg);
    return `/uploads/${relative.split('\\').join('/')}`;
  }

  private failed(source: string, err: unknown): MessageAttachment {
    const reason: Failure = err instanceof MediaFailure ? err.reason : 'download_failed';
    this.logger.warn(`Customer photo not stored (${reason}) from ${source}: ${err instanceof Error ? err.message : err}`);
    return { type: 'customer_photo', mediaId: source, error: reason };
  }
}

function isOwnCopy(url: string): boolean {
  return isCopyIn(FOLDER, url);
}

/** One of our copies of a story's, post's or reel's image (that tenant's, when given). */
export function isContentCopy(url: string, tenantId?: string): boolean {
  return isCopyIn(CONTENT_FOLDER, url, tenantId);
}

/** A file at `uploads/<folder>/<tenant>/<file>` once the URL is resolved, so `..` can't reach another folder. */
function isCopyIn(folder: string, url: string, tenantId?: string): boolean {
  const file = uploadPath(url);
  if (!file) return false;
  const parts = relative(join(uploadsRoot(), folder), file).split(sep);
  return parts.length === 2 && parts[0] !== '..' && (!tenantId || parts[0] === tenantId);
}

/**
 * Fetch through `safeFetch` (public addresses only, each redirect checked, a
 * timeout and a size cap), one retry. A file over the cap or a refused link
 * isn't retried. Throws `MediaFailure` ('too_large', 'unreadable' for a
 * refused video, or 'download_failed').
 */
export async function downloadMedia(url: string, opts: DownloadOptions = {}): Promise<Downloaded> {
  return withAttempts(opts, async () => {
    const res = await safeFetch(url, fetchOptions(opts));
    return { body: res.body, contentType: contentTypeOf(res.headers) };
  });
}

/** `downloadMedia` streamed into `file`, so a video never sits in memory. */
export async function downloadToFile(url: string, file: string, opts: DownloadOptions = {}): Promise<{ contentType: string }> {
  return withAttempts(opts, async () => {
    const res = await safeFetch(url, { ...fetchOptions(opts), toFile: file });
    return { contentType: contentTypeOf(res.headers) };
  });
}

function fetchOptions(opts: DownloadOptions) {
  return {
    timeoutMs: opts.timeoutMs ?? DOWNLOAD_TIMEOUT_MS,
    maxBytes: opts.maxBytes ?? MAX_SOURCE_BYTES,
    onHeaders: (status: number, headers: Record<string, string>) => {
      if (status < 200 || status >= 300) throw new Error(`HTTP ${status}`);
      if (opts.refuseVideo && contentTypeOf(headers).startsWith('video/')) throw new MediaFailure('unreadable', 'a video');
    },
  };
}

async function withAttempts<T>(opts: DownloadOptions, attempt: () => Promise<T>): Promise<T> {
  const attempts = opts.attempts ?? DOWNLOAD_ATTEMPTS;
  let lastError: unknown;
  for (let n = 1; n <= attempts; n++) {
    try {
      return await attempt();
    } catch (err) {
      if (err instanceof MediaFailure) throw err;
      if (err instanceof TooLargeError) throw new MediaFailure('too_large', err.message);
      if (err instanceof UnsafeUrlError) throw new MediaFailure('download_failed', err.message);
      lastError = err;
      if (n < attempts) await new Promise((r) => setTimeout(r, 1000));
    }
  }
  throw new MediaFailure('download_failed', lastError instanceof Error ? lastError.message : String(lastError));
}

/** Content-Type, lower case, without parameters. */
function contentTypeOf(headers: Record<string, string>): string {
  return (headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
}
