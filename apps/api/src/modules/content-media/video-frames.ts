import sharp = require('sharp');
import { FFMPEG, parseDuration, runFfmpeg as run } from '../../common/ffmpeg';

export { parseDuration };

/** Longest video we take frames from. Stories run up to 60 s, reels up to 3 minutes. */
export const MAX_VIDEO_SECONDS = 180;
/** One ffmpeg run (reading the duration, or one frame). */
const RUN_TIMEOUT_MS = 8_000;
/** All the frames of one video. Frames not taken by then are skipped. */
const FRAMES_BUDGET_MS = 12_000;
/** A single frame bigger than this is a broken stream, not a picture. */
const MAX_FRAME_BYTES = 15 * 1024 * 1024;
/** White lines between the frames of a contact sheet, so the model sees four pictures, not one. */
const SHEET_GAP = 8;

/** Only files ffmpeg reads, as the containers stories and reels come in: a crafted file can't make it open a URL. */
const INPUT_LIMITS = ['-protocol_whitelist', 'file', '-format_whitelist', 'mov,mp4,m4a,3gp,3g2,mj2,matroska,webm'];

export class VideoRefused extends Error {}

/** `Slots.run` refused a task: every slot is busy and the waiting line is full. */
export class SlotsFull extends Error {}

/**
 * At most `size` tasks at once; up to `maxWaiting` more wait their turn, and
 * past that `run` throws `SlotsFull`. Keeps ffmpeg from taking every core and
 * the videos waiting for it from piling up.
 */
export class Slots {
  private active = 0;
  private readonly waiting: Array<() => void> = [];

  constructor(
    private readonly size: number,
    private readonly maxWaiting = Infinity,
  ) {}

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.active < this.size) this.active++;
    else if (this.waiting.length >= this.maxWaiting) throw new SlotsFull(`${this.waiting.length} tasks already waiting`);
    // A finishing task hands its slot straight over, so a newcomer can't take it in between.
    else await new Promise<void>((resolve) => this.waiting.push(resolve));
    try {
      return await task();
    } finally {
      const next = this.waiting.shift();
      if (next) next();
      else this.active--;
    }
  }
}

/**
 * About `count` frames from a video file, evenly spaced, skipping the first
 * and last 5 % (title cards, fades, the end screen). Frames that can't be
 * read are left out. Throws `VideoRefused` for a video longer than
 * MAX_VIDEO_SECONDS or a file with no video stream.
 */
export async function extractFrames(file: string, count: number): Promise<Buffer[]> {
  if (!FFMPEG) throw new VideoRefused('no ffmpeg binary for this platform');
  // With no output, ffmpeg prints what the file holds and exits with an error.
  const probe = await runFfmpeg(['-hide_banner', ...INPUT_LIMITS, '-i', file], RUN_TIMEOUT_MS);
  if (!/Stream #.*Video:/.test(probe.stderr)) throw new VideoRefused('no video stream');
  const duration = parseDuration(probe.stderr);
  if (duration !== null && duration > MAX_VIDEO_SECONDS) throw new VideoRefused(`${Math.round(duration)} s long`);

  const deadline = Date.now() + FRAMES_BUDGET_MS;
  const frames: Buffer[] = [];
  for (const t of frameTimes(duration, count)) {
    if (Date.now() > deadline) break;
    // -ss before -i seeks by keyframe, so each frame costs about the same however long the video is.
    const run = await runFfmpeg(
      ['-hide_banner', '-loglevel', 'error', ...INPUT_LIMITS, '-ss', t.toFixed(2), '-i', file, '-frames:v', '1', '-an',
        '-f', 'image2pipe', '-c:v', 'mjpeg', '-q:v', '3', 'pipe:1'],
      RUN_TIMEOUT_MS,
    ).catch(() => null);
    if (run && run.code === 0 && run.stdout.length > 0) frames.push(run.stdout);
  }
  return frames;
}

/** When to take each frame: `count` points from 5 % to 95 % of the video. A few early points when the length is unknown. */
export function frameTimes(duration: number | null, count: number): number[] {
  if (duration === null || duration <= 0) return [0.5, 2, 4, 6].slice(0, count);
  if (count === 1) return [duration / 2];
  const start = duration * 0.05;
  const step = (duration * 0.9) / (count - 1);
  return Array.from({ length: count }, (_, i) => start + i * step);
}

/**
 * Which frames to show, as indices in time order: near-duplicates of an
 * earlier frame dropped (a photo story with music is one picture), then, if
 * more than `max` are left, the `max` most different, starting from the two
 * furthest apart. Frames without a hash (unreadable) are left out.
 */
export function pickDistinct(
  hashes: Array<string | null>,
  max: number,
  distance: (a: string, b: string) => number,
  sameBelow: number,
): number[] {
  const kept: number[] = [];
  for (const [i, hash] of hashes.entries()) {
    if (hash === null) continue;
    if (!kept.some((k) => distance(hashes[k]!, hash) <= sameBelow)) kept.push(i);
  }
  if (kept.length <= max) return kept;

  const d = (a: number, b: number) => distance(hashes[a]!, hashes[b]!);
  let first = [kept[0], kept[1]];
  for (const a of kept) for (const b of kept) if (a < b && d(a, b) > d(first[0], first[1])) first = [a, b];
  const chosen = [...first];
  while (chosen.length < max) {
    const next = kept
      .filter((i) => !chosen.includes(i))
      .map((i) => ({ i, nearest: Math.min(...chosen.map((c) => d(i, c))) }))
      .sort((a, b) => b.nearest - a.nearest)[0];
    chosen.push(next.i);
  }
  return chosen.sort((a, b) => a - b);
}

/**
 * Frames tiled two to a row into one JPEG `width` px wide, in order. The
 * agent gets one image (about 1k tokens) instead of four, and at this width
 * text on the frames (a name, a price) stays readable.
 */
export async function contactSheet(frames: Buffer[], width: number): Promise<Buffer> {
  const tileWidth = Math.floor((width - SHEET_GAP) / 2);
  const first = await sharp(frames[0]).metadata();
  const aspect = first.width && first.height ? first.height / first.width : 16 / 9;
  const tileHeight = Math.round(tileWidth * aspect);
  const rows = Math.ceil(frames.length / 2);
  const tiles = await Promise.all(
    frames.map((f) =>
      sharp(f).resize({ width: tileWidth, height: tileHeight, fit: 'contain', background: '#ffffff' }).toBuffer(),
    ),
  );
  return sharp({
    create: {
      width: tileWidth * 2 + SHEET_GAP,
      height: tileHeight * rows + SHEET_GAP * (rows - 1),
      channels: 3,
      background: '#ffffff',
    },
  })
    .composite(
      tiles.map((input, i) => ({
        input,
        left: (i % 2) * (tileWidth + SHEET_GAP),
        top: Math.floor(i / 2) * (tileHeight + SHEET_GAP),
      })),
    )
    .jpeg({ quality: 90 })
    .toBuffer();
}

/** One ffmpeg run, with a single frame's size as the cap on what it writes. */
function runFfmpeg(args: string[], timeoutMs: number) {
  return run(args, timeoutMs, MAX_FRAME_BYTES);
}
