import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { mkdir, readFile, unlink, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import sharp = require('sharp');
import { uploadPath, uploadsRoot } from '../../common/uploads';
import type { MessageAttachment } from '../conversations/entities/message.entity';

/** Long side of our copy. A phone photo drops from ~1,850 to ~1,000 input tokens per model call; text in a screenshot stays readable. */
const MAX_SIDE = 1024;
/** Bigger sources are refused rather than downloaded. Everything smaller is shrunk, so the model never sees a large file. */
const MAX_SOURCE_BYTES = 20 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 15_000;
const DOWNLOAD_ATTEMPTS = 2;
const FOLDER = 'customer-media';

export interface LoadedImage {
  data: Uint8Array;
  mediaType: string;
}

type Failure = NonNullable<MessageAttachment['error']>;

class MediaFailure extends Error {
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
      return { type: 'customer_photo', mediaId: sourceUrl, url: await this.save(tenantId, await download(sourceUrl)) };
    } catch (err) {
      return this.failed(sourceUrl, err);
    }
  }

  /** A photo uploaded straight to us (the admin console); its own URL becomes the media id. */
  async storeFromBuffer(tenantId: string, source: Buffer): Promise<MessageAttachment> {
    try {
      if (source.length > MAX_SOURCE_BYTES) throw new MediaFailure('too_large', `${source.length} bytes`);
      const url = await this.save(tenantId, source);
      return { type: 'customer_photo', mediaId: url, url };
    } catch (err) {
      return this.failed('upload', err);
    }
  }

  /** The bytes of our copy, or null when it is gone or the URL isn't one of ours. */
  async load(url: string): Promise<LoadedImage | null> {
    const file = isOwnCopy(url) ? uploadPath(url) : null;
    if (!file) return null;
    try {
      return { data: new Uint8Array(await readFile(file)), mediaType: 'image/jpeg' };
    } catch (err) {
      this.logger.warn(`Customer photo ${url} could not be loaded: ${err instanceof Error ? err.message : err}`);
      return null;
    }
  }

  /** Delete our copies, e.g. with the conversation they belong to. Other URLs are ignored. */
  async remove(urls: string[]): Promise<void> {
    for (const url of urls) {
      const file = isOwnCopy(url) ? uploadPath(url) : null;
      if (!file) continue;
      await unlink(file).catch((err: NodeJS.ErrnoException) => {
        if (err.code !== 'ENOENT') this.logger.warn(`Could not delete ${url}: ${err.message}`);
      });
    }
  }

  private async save(tenantId: string, source: Buffer): Promise<string> {
    let jpeg: Buffer;
    try {
      jpeg = await sharp(source)
        .rotate()
        .resize({ width: MAX_SIDE, height: MAX_SIDE, fit: 'inside', withoutEnlargement: true })
        .flatten({ background: '#ffffff' })
        .jpeg({ quality: 82 })
        .toBuffer();
    } catch (err) {
      throw new MediaFailure('unreadable', err instanceof Error ? err.message : String(err));
    }
    const relative = join(FOLDER, tenantId, `${randomUUID()}.jpg`);
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
  return url.startsWith(`/uploads/${FOLDER}/`) && uploadPath(url) !== null;
}

/** Fetch with a timeout and a size cap, one retry. A file over the cap isn't retried. */
async function download(url: string): Promise<Buffer> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= DOWNLOAD_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (Number(res.headers.get('content-length') ?? 0) > MAX_SOURCE_BYTES) {
        throw new MediaFailure('too_large', `content-length ${res.headers.get('content-length')}`);
      }
      const body = Buffer.from(await res.arrayBuffer());
      if (body.length > MAX_SOURCE_BYTES) throw new MediaFailure('too_large', `${body.length} bytes`);
      return body;
    } catch (err) {
      if (err instanceof MediaFailure) throw err;
      lastError = err;
      if (attempt < DOWNLOAD_ATTEMPTS) await new Promise((r) => setTimeout(r, 1000));
    }
  }
  throw new MediaFailure('download_failed', lastError instanceof Error ? lastError.message : String(lastError));
}
