import { execFile } from 'node:child_process';
import { mkdir, rename, stat, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { promisify } from 'node:util';
const execute = promisify(execFile);
async function ffmpeg(args: string[]) {
  await execute('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-threads', '2', ...args], { timeout: 60_000 });
}
export async function still(input: string, output: string) {
  await mkdir(dirname(output), { recursive: true });
  const partial = `${output}.partial.webp`;
  await ffmpeg(['-i', input, '-frames:v', '1', '-c:v', 'libwebp', '-lossless', '1', partial]);
  await rename(partial, output);
}
export async function clip(input: string, output: string, seconds: number) {
  await mkdir(dirname(output), { recursive: true });
  const partial = `${output}.partial.mp4`;
  await ffmpeg(['-sseof', `-${seconds}`, '-i', input, '-an', '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2,fps=30', '-c:v', 'libx264', '-preset', 'slow', '-crf', '28', '-movflags', '+faststart', partial]);
  if ((await stat(partial)).size > 1_500_000) throw new Error(`Capture exceeds website clip budget: ${output}`);
  await rename(partial, output);
}
export async function demo(input: string, output: string) {
  await mkdir(dirname(output), { recursive: true });
  const partial = `${output}.partial.gif`;
  try {
    // Keep the largest readable rendition that meets the committed README budget.
    for (const width of [1200, 1080, 960]) {
      await ffmpeg(['-i', input, '-filter_complex', `[0:v]fps=8,scale=${width}:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=3`, '-loop', '0', partial]);
      if ((await stat(partial)).size <= 10_000_000) { await rename(partial, output); return; }
    }
    throw new Error(`Demo exceeds 10 MB: ${output}`);
  } finally { await rm(partial, { force: true }); }
}
