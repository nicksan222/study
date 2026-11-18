import core from 'playwright-core/lib/coreBundle';
import image from 'playwright-core/lib/utilsBundle';

export const screenshotTolerance = {
  threshold: 0.2,
  // Bound rasterization drift without letting large captures hide changed controls.
  maxDiffPixels: 10,
  maxDiffPixelRatio: 0.0001
};

// Use the comparator and PNG decoder bundled with the pinned Playwright runner.
const comparePng = core.utils.getComparator('image/png');

const { PNG } = image;

type Png = ReturnType<typeof PNG.sync.read>;

export function matchesBaseline(actual: Buffer, expected: Buffer): boolean {
  return (
    actual.equals(expected) ||
    matchesHorizontalShift(actual, expected) ||
    comparePng(actual, expected, screenshotTolerance) === null
  );
}

export function matchesHorizontalShift(actual: Buffer, expected: Buffer): boolean {
  const capture = PNG.sync.read(actual);
  const baseline = PNG.sync.read(expected);

  if (capture.width !== baseline.width || capture.height !== baseline.height) return false;

  for (const pixels of [1, 2, 3]) {
    if (pixels >= capture.width) break;

    if (
      matchesShiftRight(capture, baseline, pixels) ||
      matchesShiftRight(baseline, capture, pixels)
    )
      return true;
  }

  return false;
}

function matchesShiftRight(shifted: Png, original: Png, pixels: number): boolean {
  const pixelBytes = 4;
  const rowBytes = original.width * pixelBytes;
  const offset = pixels * pixelBytes;

  for (let start = 0; start < original.data.length; start += rowBytes) {
    const end = start + rowBytes;

    if (original.data.compare(shifted.data, start + offset, end, start, end - offset) !== 0)
      return false;

    // Require continuous edge pixels on both sides so a shift cannot hide clipped content.
    const left = original.data.readUInt32LE(start);
    const right = shifted.data.readUInt32LE(end - pixelBytes);

    for (let edge = 0; edge < offset; edge += pixelBytes) {
      if (
        shifted.data.readUInt32LE(start + edge) !== left ||
        original.data.readUInt32LE(end - offset + edge) !== right
      )
        return false;
    }
  }

  return true;
}
