import { spawn } from 'child_process';
import { EventEmitter } from 'events';
import sharp = require('sharp');
import { contactSheet, extractFrames, frameTimes, parseDuration, pickDistinct, Slots, SlotsFull } from './video-frames';

jest.mock('child_process', () => ({ spawn: jest.fn() }));
const spawnMock = spawn as jest.MockedFunction<typeof spawn>;

describe('parseDuration', () => {
  it("reads the length from ffmpeg's report, and nothing when it is unknown", () => {
    expect(parseDuration('  Duration: 00:01:02.50, start: 0.000000, bitrate: 1205 kb/s')).toBe(62.5);
    expect(parseDuration('  Duration: N/A, bitrate: N/A')).toBeNull();
  });
});

describe('frameTimes', () => {
  it('spreads the frames from 5 % to 95 % of the video', () => {
    expect(frameTimes(100, 8).map((t) => Math.round(t * 10) / 10)).toEqual([5, 17.9, 30.7, 43.6, 56.4, 69.3, 82.1, 95]);
  });

  it('takes a few early frames when the length is unknown', () => {
    expect(frameTimes(null, 8)).toEqual([0.5, 2, 4, 6]);
  });
});

describe('pickDistinct', () => {
  // Hashes as numbers, distance as their difference: easy to reason about.
  const distance = (a: string, b: string) => Math.abs(Number(a) - Number(b));

  it('drops near-duplicates of an earlier frame and keeps time order', () => {
    expect(pickDistinct(['0', '1', '40', '41', '80'], 4, distance, 5)).toEqual([0, 2, 4]);
  });

  it('keeps the most different frames when there are more than enough', () => {
    // 0 and 100 are furthest apart; then 50 is furthest from both; then 25 or 75.
    const picked = pickDistinct(['0', '20', '50', '60', '100', '75'], 4, distance, 5);
    expect(picked).toHaveLength(4);
    expect(picked).toEqual(expect.arrayContaining([0, 2, 4]));
    expect(picked).toEqual([...picked].sort((a, b) => a - b));
  });

  it('leaves out frames that could not be read', () => {
    expect(pickDistinct([null, '10', null], 4, distance, 5)).toEqual([1]);
  });
});

describe('contactSheet', () => {
  const frame = (color: string) => sharp({ create: { width: 720, height: 1280, channels: 3, background: color } }).jpeg().toBuffer();

  it('tiles portrait frames two to a row into one image 1536 px wide', async () => {
    const sheet = await contactSheet(await Promise.all(['#ff0000', '#00ff00', '#0000ff', '#ffff00'].map(frame)), 1536);
    const meta = await sharp(sheet).metadata();
    expect(meta.format).toBe('jpeg');
    expect(meta.width).toBe(1536);
    expect(meta.height).toBe(2 * Math.round(764 * (1280 / 720)) + 8);

    // Top left is the first frame, bottom right the last.
    const { data, info } = await sharp(sheet).raw().toBuffer({ resolveWithObject: true });
    const pixel = (x: number, y: number) => [...data.subarray((y * info.width + x) * 3, (y * info.width + x) * 3 + 3)];
    expect(pixel(10, 10)[0]).toBeGreaterThan(200);
    expect(pixel(info.width - 10, info.height - 10).slice(0, 2).every((v) => v > 200)).toBe(true);
  });

  it('leaves the empty cell white for three frames', async () => {
    const sheet = await contactSheet(await Promise.all(['#000000', '#000000', '#000000'].map(frame)), 1536);
    const { data, info } = await sharp(sheet).raw().toBuffer({ resolveWithObject: true });
    const at = ((info.height - 10) * info.width + info.width - 10) * 3;
    expect(data[at]).toBeGreaterThan(240);
  });
});

describe('Slots', () => {
  it('runs at most as many tasks at once as it has slots', async () => {
    const slots = new Slots(2);
    let running = 0;
    let most = 0;
    const task = () =>
      slots.run(async () => {
        running++;
        most = Math.max(most, running);
        await new Promise((r) => setImmediate(r));
        running--;
      });
    await Promise.all([task(), task(), task(), task(), task()]);
    expect(most).toBe(2);
  });

  it('refuses a task once the waiting line is full', async () => {
    const slots = new Slots(1, 2);
    let open: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (open = resolve));
    const held = [slots.run(() => gate), slots.run(() => gate), slots.run(() => gate)];
    await expect(slots.run(async () => 'late')).rejects.toBeInstanceOf(SlotsFull);
    open();
    await Promise.all(held);
    // Room again once the line has moved.
    await expect(slots.run(async () => 'next')).resolves.toBe('next');
  });
});

describe('extractFrames', () => {
  /** A fake ffmpeg run: what it writes, and its exit code. */
  function run(out: { stdout?: Buffer; stderr?: string; code: number }) {
    const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter(), kill: jest.fn() });
    setImmediate(() => {
      if (out.stderr) child.stderr.emit('data', Buffer.from(out.stderr));
      if (out.stdout) child.stdout.emit('data', out.stdout);
      child.emit('close', out.code);
    });
    return child as never;
  }

  it('lets ffmpeg read only local files in the containers stories and reels use', async () => {
    spawnMock.mockImplementation(((_bin: string, args: string[]) =>
      args.includes('-ss')
        ? run({ stdout: Buffer.from('jpeg'), code: 0 })
        : run({ stderr: 'Duration: 00:00:10.00, start: 0\n  Stream #0:0: Video: h264', code: 1 })) as never);

    expect(await extractFrames('/tmp/video', 2)).toHaveLength(2);
    expect(spawnMock).toHaveBeenCalledTimes(3);
    for (const [, args] of spawnMock.mock.calls) {
      const list = args as string[];
      const input = list.indexOf('-i');
      expect(list.slice(0, input)).toEqual(
        expect.arrayContaining(['-protocol_whitelist', 'file', '-format_whitelist', 'mov,mp4,m4a,3gp,3g2,mj2,matroska,webm']),
      );
      expect(list[list.indexOf('-protocol_whitelist') + 1]).toBe('file');
    }
  });
});
