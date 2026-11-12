import { Injectable, Logger } from '@nestjs/common';
import { access, mkdtemp, open, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { DataSource } from 'typeorm';
import { MessageDirection } from '@direct-mate/shared';
import { uploadPath } from '../../common/uploads';
import { ImageHashService } from '../catalog/image-hash.service';
import { ContentDetails, InstagramContentService } from '../channels/instagram/instagram-content.service';
import type { InstagramMediaMapping } from '../channels/instagram/entities/instagram-media-mapping.entity';
import { CONTENT_ATTACHMENTS, MessageAttachment } from '../conversations/entities/message.entity';
import {
  CONTENT_FOLDER,
  CustomerMediaService,
  Downloaded,
  downloadMedia,
  downloadToFile,
  isContentCopy,
} from '../customer-media/customer-media.service';
import { contactSheet, extractFrames, pickDistinct, Slots, SlotsFull } from './video-frames';

/** How long a turn waits for content images still being made. On Instagram that's on top of the 5 s reply debounce. */
export const CAPTURE_WAIT_MS = 3_000;
/** A video's cover is fetched as a stand-in once its frames have taken this long. */
const COVER_AFTER_MS = 2_000;
const VIDEO_MAX_BYTES = 50 * 1024 * 1024;
const VIDEO_DOWNLOAD_TIMEOUT_MS = 20_000;
const FRAMES_SAMPLED = 8;
const FRAMES_SHOWN = 4;
const SHEET_WIDTH = 1536;
/** A sheet of four portrait frames is about 1536 × 2724; the cap only stops something absurd. */
const SHEET_MAX_SIDE = 3072;
/** File-name mark of a copy made from a video's frames, so a cached copy says what it shows. */
const FRAMES_SUFFIX = '-frames';
const MAX_CAPTION_CHARS = 2200;
/** Videos (or links that may be one) downloaded and read by ffmpeg at once. */
const MEDIA_SLOTS = 2;
/** Videos waiting for a slot; past this many, a video falls back to its cover. */
const MEDIA_QUEUE = 6;
/** An attachment tried once isn't tried again for this long (a failed copy would otherwise retry every turn). */
const ATTEMPT_MEMORY_MS = 10 * 60 * 1000;
/** A capture still running after this stops holding up anyone waiting on its conversation. */
const TRACK_TIMEOUT_MS = 60_000;

/** What a message says about one story, post or reel. */
export interface ContentRef {
  type: MessageAttachment['type'];
  mediaId: string;
  sourceUrl?: string;
  caption?: string;
  reel?: boolean;
}

/** What a capture adds to the attachment. */
export type CapturedContent = Pick<MessageAttachment, 'url' | 'image' | 'caption' | 'reel' | 'foreign'>;

type Copy = { url: string; image: NonNullable<MessageAttachment['image']> };

interface Inflight {
  done: Promise<CapturedContent>;
  standIn: CapturedContent | null;
  listeners: Set<(c: CapturedContent) => void>;
}

/**
 * Our copy of the story, post or reel a customer replied to, shared or
 * commented on, so the agent sees it the way it sees customer photos.
 *
 * - **Once per piece of content.** The copy's path is kept on its
 *   `instagram_media_mappings` row, so the next customer replying to the same
 *   story gets it from there. Captures of the same media running at once are
 *   shared.
 * - **A picture** comes from Graph's `media_url` for the shop's own content,
 *   else the webhook's link; shrunk to 1024 px, EXIF dropped.
 * - **A video** (story, reel, video post) becomes images, since the model
 *   reads images, not video: about 8 frames, the 4 most different tiled into
 *   one 2×2 contact sheet (one picture when they are all alike). If that
 *   fails: the cover, then the webhook's link if it is a picture, then nothing
 *   (the caption alone). If it is slow, the cover stands in for the turn and
 *   the sheet is kept for the next customer. Videos are streamed to a temp
 *   file, two at a time with six waiting; past that, the cover.
 * - **Another account's post** (Graph says it can't read it) is copied from
 *   the webhook's link, marked `foreign`, and not remembered as the shop's
 *   content.
 *
 * Never throws: a failure leaves the attachment without a copy.
 */
@Injectable()
export class ContentMediaService {
  private readonly logger = new Logger(ContentMediaService.name);
  private readonly slots = new Slots(MEDIA_SLOTS, MEDIA_QUEUE);
  private readonly inflight = new Map<string | symbol, Inflight>();
  /** Captures each conversation's next turn should wait for. */
  private readonly pending = new Map<string, Set<Promise<void>>>();
  /** `messageId:index` → when its capture started. */
  private readonly attempted = new Map<string, number>();

  constructor(
    private readonly content: InstagramContentService,
    private readonly media: CustomerMediaService,
    private readonly hashes: ImageHashService,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Start copying the content a saved message points at, writing each result
   * onto the message's attachment (a stand-in cover first if the video is
   * slow). Returns at once; the conversation's next turn waits for it in
   * `prepare`.
   */
  startForMessage(tenantId: string, conversationId: string, messageId: string, attachments: MessageAttachment[]): void {
    for (const [index, attachment] of attachments.entries()) {
      if (!CONTENT_ATTACHMENTS.has(attachment.type) || attachment.url) continue;
      const key = `${messageId}:${index}`;
      if (this.triedRecently(key)) continue;
      this.remember(key);

      // Writes go in order, and the final one never takes away a cover that already stood in. A failed write is
      // logged: a rejection nobody handles would end the process.
      let writes = Promise.resolve();
      let standIn: CapturedContent = {};
      let final = false;
      const write = (captured: CapturedContent) => {
        const merged = { ...attachment, ...defined(captured) };
        writes = writes
          .then(() => this.writeAttachment(messageId, index, merged))
          .catch((err) => this.logger.warn(`Content copy for message ${messageId} not written: ${errorText(err)}`));
        return writes;
      };
      const task = this.capture(tenantId, attachment, (cover) => {
        if (final) return;
        standIn = cover;
        void write(cover);
      })
        .then((captured) => {
          final = true;
          return write(captured.url ? captured : { ...captured, url: standIn.url, image: standIn.image });
        })
        .catch((err) => this.logger.warn(`Content copy for message ${messageId} failed: ${errorText(err)}`));
      this.track(conversationId, task);
    }
  }

  /**
   * Before a turn: copy the content in the customer's new messages that
   * hasn't been copied yet, and wait up to `waitMs` for every copy still
   * being made for this conversation. A copy that isn't ready by then
   * carries on, for later turns and the next customer.
   */
  async prepare(tenantId: string, conversationId: string, waitMs = CAPTURE_WAIT_MS): Promise<void> {
    try {
      const rows: Array<{ id: string; attachments: MessageAttachment[] | null }> = await this.dataSource.query(
        `SELECT id, attachments FROM messages
          WHERE conversation_id = $1 AND direction = $2 AND attachments IS NOT NULL
            AND created_at > COALESCE(
              (SELECT max(created_at) FROM messages WHERE conversation_id = $1 AND direction = $3), '-infinity')
          ORDER BY created_at`,
        [conversationId, MessageDirection.Inbound, MessageDirection.Outbound],
      );
      for (const row of rows) {
        if (Array.isArray(row.attachments)) this.startForMessage(tenantId, conversationId, row.id, row.attachments);
      }
      const waiting = [...(this.pending.get(conversationId) ?? [])];
      if (waiting.length > 0) await withDeadline(Promise.all(waiting), waitMs, undefined);
    } catch (err) {
      this.logger.warn(`Preparing content images for ${conversationId} failed (turn goes on): ${errorText(err)}`);
    }
  }

  /**
   * Our copy of one story, post or reel, with its caption. `onStandIn` gets a
   * video's cover when its frames are slow. Captures of the same media run
   * once.
   */
  capture(tenantId: string, ref: ContentRef, onStandIn?: (c: CapturedContent) => void): Promise<CapturedContent> {
    // A placeholder media id names nothing: no sharing.
    const key = isMediaId(ref.mediaId) || isHttpUrl(ref.mediaId) ? `${tenantId}:${ref.mediaId}` : Symbol();
    let entry = this.inflight.get(key);
    if (!entry) {
      const created: Inflight = { standIn: null, listeners: new Set(), done: Promise.resolve({}) };
      created.done = this.run(tenantId, ref, (standIn) => {
        created.standIn = standIn;
        for (const listener of created.listeners) listener(standIn);
      }).finally(() => this.inflight.delete(key));
      this.inflight.set(key, created);
      entry = created;
    }
    if (onStandIn) {
      if (entry.standIn) onStandIn(entry.standIn);
      else entry.listeners.add(onStandIn);
    }
    // A shared capture may have started from another message: this one's own caption and reel flag still count.
    return entry.done.then((c) => ({ ...c, caption: c.caption ?? clipCaption(ref.caption), reel: c.reel || ref.reel || undefined }));
  }

  /**
   * A catalog product whose photo is this image: same perceptual hash within
   * the threshold customer photos use, and no other product as close.
   */
  async matchCatalogImage(tenantId: string, url: string): Promise<{ productId: string; color: string | null } | null> {
    try {
      const hash = await this.hashes.hashFromUrl(url);
      if (!hash) return null;
      const rows: Array<{ product_id: string; color: string | null; phash: string }> = await this.dataSource.query(
        `SELECT pm.product_id, pm.color, pm.phash FROM product_media pm
           JOIN products p ON p.id = pm.product_id
          WHERE p.tenant_id = $1 AND p.status = 'active' AND pm.phash IS NOT NULL`,
        [tenantId],
      );
      const ranked = rows
        .map((r) => ({ ...r, distance: this.hashes.hammingDistance(hash, r.phash) }))
        .filter((r) => r.distance <= ImageHashService.MATCH_THRESHOLD)
        .sort((a, b) => a.distance - b.distance);
      if (ranked.length === 0) return null;
      const closest = ranked.filter((r) => r.distance === ranked[0].distance);
      // A tie between two products is no match; the same photo stored for two colours of one product is.
      if (new Set(closest.map((r) => r.product_id)).size > 1) return null;
      const colors = new Set(closest.map((r) => r.color));
      return { productId: closest[0].product_id, color: colors.size === 1 ? closest[0].color : null };
    } catch (err) {
      this.logger.warn(`pHash match for ${url} failed: ${errorText(err)}`);
      return null;
    }
  }

  private async run(tenantId: string, ref: ContentRef, onStandIn: (c: CapturedContent) => void): Promise<CapturedContent> {
    const known = isMediaId(ref.mediaId);
    const webhookUrl = ref.sourceUrl ?? (isHttpUrl(ref.mediaId) ? ref.mediaId : undefined);
    try {
      const row = known ? await this.content.findByMediaId(tenantId, ref.mediaId).catch(() => null) : null;
      if (row?.imagePath && (await fileExists(row.imagePath, tenantId))) {
        return {
          url: row.imagePath,
          image: row.imagePath.includes(`${FRAMES_SUFFIX}.`) ? 'video_frames' : 'picture',
          caption: clipCaption(ref.caption ?? row.caption),
          reel: ref.reel || row.mediaProductType === 'REELS' || undefined,
        };
      }

      // A path whose file is gone (a restored database, a cleared volume) gets replaced by the new copy.
      const stalePath = row?.imagePath ?? null;

      // No media id: Graph can't be asked, as when it says it can't read the media.
      const read = known
        ? await this.content.readMediaDetails(tenantId, ref.mediaId).catch(() => ({ details: null, refused: false }))
        : { details: null, refused: true };
      const details = read.details;
      // Customers reply to the shop's own stories and comment under its posts; a share is someone's post, maybe not
      // the shop's. A share Graph refuses is another account's; one it failed to read briefly stays unknown: not
      // marked, and not kept as the shop's. A post we have a row for is the shop's.
      const unread = ref.type === 'post_share' && !details && !row;
      const foreign = unread && read.refused ? true : undefined;
      const reel = ref.reel || details?.productType === 'REELS' || undefined;
      const caption = clipCaption(ref.caption ?? details?.caption ?? row?.caption);
      const base: CapturedContent = { caption, reel, foreign };

      const copy = await this.copy(tenantId, {
        primary: details?.mediaUrl ?? webhookUrl,
        webhook: webhookUrl,
        cover: details?.thumbnailUrl ?? undefined,
        kind: details?.mediaType === 'video' || reel ? 'video' : details?.mediaType === 'image' ? 'picture' : 'unknown',
        onCover: (url) => onStandIn({ ...base, url, image: 'video_cover' }),
      });

      if (known && !unread) await this.rememberContent(tenantId, ref, row, details, caption, copy, stalePath);
      return { ...base, ...(copy && { url: copy.url, image: copy.image }) };
    } catch (err) {
      this.logger.warn(`Content ${ref.type} ${ref.mediaId} not copied: ${errorText(err)}`);
      return { caption: clipCaption(ref.caption), reel: ref.reel || undefined };
    }
  }

  /**
   * The best copy we can make, falling back from frames to the cover to the
   * webhook's picture. Null when there is none. `kind`: what Graph says the
   * primary link is ('unknown' for a webhook's link, which may be a video).
   */
  private async copy(
    tenantId: string,
    from: {
      primary?: string;
      webhook?: string;
      cover?: string;
      kind: 'picture' | 'video' | 'unknown';
      onCover: (url: string) => void;
    },
  ): Promise<Copy | null> {
    // Once the result is decided, a cover still downloading is neither saved nor shown.
    let done = false;
    let cover: Promise<string | null> | null = null;
    const startCover = () =>
      (cover ??= from.cover
        ? this.pictureFrom(tenantId, from.cover, () => done)
            .then((url) => {
              if (url && !done) from.onCover(url);
              return url;
            })
            .catch(() => null)
        : Promise.resolve(null));
    let coverTimer: ReturnType<typeof setTimeout> | undefined;
    const armCover = () => {
      if (from.cover && !coverTimer) coverTimer = setTimeout(() => void startCover(), COVER_AFTER_MS);
    };
    if (from.kind === 'video') armCover();

    try {
      if (from.primary) {
        const made =
          from.kind === 'picture'
            ? await this.pictureFrom(tenantId, from.primary).then((url): Copy | null => (url ? { url, image: 'picture' } : null))
            : await this.fromFile(tenantId, from.primary, armCover);
        if (made) return made;
      }

      const coverUrl = await startCover();
      if (coverUrl) return { url: coverUrl, image: 'video_cover' };
      if (from.webhook && from.webhook !== from.primary) {
        const url = await this.pictureFrom(tenantId, from.webhook);
        if (url) return { url, image: 'picture' };
      }
      return null;
    } finally {
      done = true;
      clearTimeout(coverTimer);
    }
  }

  /**
   * A link that is or may be a video, streamed to a temp file in a slot, so
   * only a few videos are downloaded or read at once: the frames of a video,
   * else the picture. Null when neither can be made, or when too many videos
   * are waiting already.
   */
  private async fromFile(tenantId: string, url: string, onVideo: () => void): Promise<Copy | null> {
    try {
      return await this.slots.run(async () => {
        const dir = await mkdtemp(join(tmpdir(), 'dm-media-'));
        try {
          const file = join(dir, 'source');
          const { contentType } = await downloadToFile(url, file, { maxBytes: VIDEO_MAX_BYTES, timeoutMs: VIDEO_DOWNLOAD_TIMEOUT_MS });
          if (await isVideoFile(file, contentType)) {
            onVideo();
            return await this.framesFrom(tenantId, file);
          }
          const saved = await this.save(tenantId, file);
          return saved ? { url: saved, image: 'picture' as const } : null;
        } finally {
          await rm(dir, { recursive: true, force: true }).catch(() => undefined);
        }
      });
    } catch (err) {
      this.logger.warn(
        err instanceof SlotsFull ? `Too many videos at once, a video waits for its cover: ${err.message}` : `Content download failed: ${errorText(err)}`,
      );
      return null;
    }
  }

  /**
   * A contact sheet of the video's most different frames. Frames all alike (a
   * photo story with music) make one picture, matched to catalog photos like
   * any picture. Null when ffmpeg can't read it.
   */
  private async framesFrom(tenantId: string, file: string): Promise<Copy | null> {
    try {
      const frames = await extractFrames(file, FRAMES_SAMPLED);
      const hashes = await Promise.all(frames.map((f) => this.hashes.hashFromBuffer(f)));
      const picked = pickDistinct(
        hashes,
        FRAMES_SHOWN,
        (a, b) => this.hashes.hammingDistance(a, b),
        ImageHashService.MATCH_THRESHOLD,
      ).map((i) => frames[i]);
      if (picked.length === 0) return null;
      if (picked.length === 1) {
        return { url: await this.media.saveImage(tenantId, picked[0], { folder: CONTENT_FOLDER }), image: 'picture' };
      }
      const sheet = await contactSheet(picked, SHEET_WIDTH);
      const url = await this.media.saveImage(tenantId, sheet, { folder: CONTENT_FOLDER, suffix: FRAMES_SUFFIX, maxSide: SHEET_MAX_SIDE });
      return { url, image: 'video_frames' };
    } catch (err) {
      this.logger.warn(`Frames not taken from a video: ${errorText(err)}`);
      return null;
    }
  }

  /** A picture's copy; never a video. Not saved when `cancelled()` says so once it has downloaded. */
  private async pictureFrom(tenantId: string, url: string, cancelled?: () => boolean): Promise<string | null> {
    const file = await this.download(url);
    if (!file || isVideo(file) || cancelled?.()) return null;
    return this.save(tenantId, file.body);
  }

  private async download(url: string): Promise<Downloaded | null> {
    try {
      return await downloadMedia(url, { refuseVideo: true });
    } catch (err) {
      this.logger.warn(`Content download failed: ${errorText(err)}`);
      return null;
    }
  }

  private async save(tenantId: string, image: Buffer | string): Promise<string | null> {
    try {
      return await this.media.saveImage(tenantId, image, { folder: CONTENT_FOLDER });
    } catch (err) {
      this.logger.warn(`Content image not saved: ${errorText(err)}`);
      return null;
    }
  }

  /**
   * Keep the copy on the content's row for the next customer, and an unknown
   * story or post as a row the store can link on the Content page. A cover
   * isn't kept: the next customer's capture tries the frames again.
   */
  private async rememberContent(
    tenantId: string,
    ref: ContentRef,
    row: InstagramMediaMapping | null,
    details: ContentDetails | null,
    caption: string | undefined,
    copy: Copy | null,
    stalePath: string | null,
  ): Promise<void> {
    const imagePath = copy && copy.image !== 'video_cover' ? copy.url : null;
    try {
      if (row?.productId) {
        if (imagePath) await this.content.saveContentImage(tenantId, ref.mediaId, imagePath, stalePath);
        return;
      }
      await this.content.saveUnlinkedMedia(tenantId, ref.mediaId, contentRowType(ref.type, details), {
        caption: caption ?? null,
        mediaUrl: details?.mediaUrl ?? null,
        permalink: details?.permalink ?? null,
        thumbnailUrl: details?.thumbnailUrl ?? null,
        productType: details?.productType ?? null,
        mediaType: details?.mediaType ?? null,
        imagePath,
      }, stalePath);
    } catch (err) {
      this.logger.warn(`Content ${ref.mediaId} not saved to its row: ${errorText(err)}`);
    }
  }

  /** One attachment of a message replaced in place, so copies of two attachments can't overwrite each other. */
  private async writeAttachment(messageId: string, index: number, attachment: MessageAttachment): Promise<void> {
    await this.dataSource.query(
      `UPDATE messages SET attachments = jsonb_set(attachments, ARRAY[$2::text], $3::jsonb)
        WHERE id = $1 AND jsonb_typeof(attachments) = 'array'`,
      [messageId, String(index), JSON.stringify(attachment)],
    );
  }

  private track(conversationId: string, task: Promise<void>): void {
    const tasks = this.pending.get(conversationId) ?? new Set<Promise<void>>();
    this.pending.set(conversationId, tasks);
    const tracked = withDeadline(task, TRACK_TIMEOUT_MS, undefined).finally(() => {
      tasks.delete(tracked);
      if (tasks.size === 0 && this.pending.get(conversationId) === tasks) this.pending.delete(conversationId);
    });
    tasks.add(tracked);
  }

  /** Tried within ATTEMPT_MEMORY_MS. An older entry is forgotten here, so it never blocks a retry. */
  private triedRecently(key: string): boolean {
    const at = this.attempted.get(key);
    if (at === undefined) return false;
    if (Date.now() - at <= ATTEMPT_MEMORY_MS) return true;
    this.attempted.delete(key);
    return false;
  }

  private remember(key: string): void {
    const now = Date.now();
    for (const [k, at] of this.attempted) {
      if (now - at > ATTEMPT_MEMORY_MS) this.attempted.delete(k);
      else break; // insertion order: the rest are newer
    }
    this.attempted.set(key, now);
  }
}

/** `media_type` for a new row: stories as the fetch names them, posts by what Graph says they are. */
function contentRowType(type: MessageAttachment['type'], details: ContentDetails | null): string {
  if (type === 'story_reply') return 'story';
  return details?.mediaType || type;
}

/** An Instagram media id (not a link, not a placeholder). */
function isMediaId(mediaId: string): boolean {
  return !!mediaId && mediaId !== 'unknown' && !isHttpUrl(mediaId);
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

/** By Content-Type, or by the first bytes: an MP4/MOV `ftyp` box or a WebM header. */
function looksLikeVideo(contentType: string, head: Buffer): boolean {
  if (contentType.startsWith('video/')) return true;
  if (contentType.startsWith('image/')) return false;
  return (head.length > 12 && head.toString('latin1', 4, 8) === 'ftyp') || (head.length > 4 && head.readUInt32BE(0) === 0x1a45dfa3);
}

function isVideo(file: Downloaded): boolean {
  return looksLikeVideo(file.contentType, file.body);
}

async function isVideoFile(path: string, contentType: string): Promise<boolean> {
  const handle = await open(path, 'r');
  try {
    const head = Buffer.alloc(16);
    const { bytesRead } = await handle.read(head, 0, head.length, 0);
    return looksLikeVideo(contentType, head.subarray(0, bytesRead));
  } finally {
    await handle.close();
  }
}

function clipCaption(caption: string | null | undefined): string | undefined {
  const text = caption?.trim();
  return text ? text.slice(0, MAX_CAPTION_CHARS) : undefined;
}

async function fileExists(url: string, tenantId: string): Promise<boolean> {
  const file = isContentCopy(url, tenantId) ? uploadPath(url) : null;
  if (!file) return false;
  return access(file).then(
    () => true,
    () => false,
  );
}

/** The promise's value, or `fallback` once `ms` have passed. */
function withDeadline<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

/** Only the fields that are set, so spreading a capture never blanks the attachment's own. */
function defined(captured: CapturedContent): CapturedContent {
  return Object.fromEntries(Object.entries(captured).filter(([, v]) => v !== undefined)) as CapturedContent;
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
