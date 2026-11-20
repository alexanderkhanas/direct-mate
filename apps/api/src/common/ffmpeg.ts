import { spawn } from 'child_process';

// ffmpeg-static is CommonJS (`module.exports = path`) while its types declare a
// default export, so it is required directly. FFMPEG_BIN overrides the path.
// eslint-disable-next-line @typescript-eslint/no-require-imports
export const FFMPEG: string | null = require('ffmpeg-static');

/** Stdout past this is a broken stream, not a result: ffmpeg is killed. */
const DEFAULT_MAX_STDOUT_BYTES = 15 * 1024 * 1024;

export interface FfmpegRun {
  code: number | null;
  stdout: Buffer;
  stderr: string;
}

/** Runs ffmpeg and collects what it wrote. Resolves with the exit code (a probe exits non-zero); killed after `timeoutMs`. */
export function runFfmpeg(args: string[], timeoutMs: number, maxStdoutBytes = DEFAULT_MAX_STDOUT_BYTES): Promise<FfmpegRun> {
  return new Promise((resolve, reject) => {
    const child = spawn(FFMPEG!, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const out: Buffer[] = [];
    let outBytes = 0;
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.on('data', (chunk: Buffer) => {
      outBytes += chunk.length;
      if (outBytes > maxStdoutBytes) child.kill('SIGKILL');
      else out.push(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      if (stderr.length < 64_000) stderr += chunk.toString();
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout: Buffer.concat(out), stderr });
    });
  });
}

/** `Duration: 00:01:02.50` from ffmpeg's report, in seconds; null when it says N/A. */
export function parseDuration(report: string): number | null {
  const m = report.match(/Duration:\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/);
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null;
}
