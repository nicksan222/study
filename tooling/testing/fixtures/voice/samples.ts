import attribution from './attribution.json';

const wordErrorBudgets = new Map([
  ['it_it_0228', 0],
  ['en_us_0165', 0],
  // Parakeet inserts an article and drops a conjunction in the unfiltered recording.
  ['it_it_0139', 2]
]);

/** FLEURS human recordings with the original transcripts and a per-clip error budget. */
export const voiceSamples = attribution.samples.map(({ id, language, reference }) => ({
  id,
  language: language.split('_')[0]!,
  reference,
  maximumWordErrors: wordErrorBudgets.get(id) ?? 1
}));

function voiceSamplePath(id: string) {
  return Bun.fileURLToPath(new URL(`./${id}.wav`, import.meta.url));
}

function pcm16Mono16k(view: DataView, start: number, size: number) {
  if (size < 16) throw new Error('Unsupported WAV fixture format');

  return (
    view.getUint16(start, true) === 1 &&
    view.getUint16(start + 2, true) === 1 &&
    view.getUint32(start + 4, true) === 16_000 &&
    view.getUint16(start + 14, true) === 16
  );
}

/** Read the corpus' uncompressed mono 16 kHz PCM WAV without an external decoder. */
export async function voiceSamplePcm(id: string) {
  return voiceFilePcm(voiceSamplePath(id));
}

/** Decode an explicitly supplied local regression recording; never fetch audio. */
export async function voiceFilePcm(path: string) {
  const bytes = await Bun.file(path).arrayBuffer();
  const view = new DataView(bytes);
  const text = (offset: number, length: number) =>
    new TextDecoder().decode(bytes.slice(offset, offset + length));

  if (text(0, 4) !== 'RIFF' || text(8, 4) !== 'WAVE') throw new Error('Invalid WAV fixture');

  let validFormat = false;

  for (let offset = 12; offset + 8 <= bytes.byteLength;) {
    const size = view.getUint32(offset + 4, true);
    const start = offset + 8;

    if (start + size > bytes.byteLength) throw new Error('Truncated WAV fixture');

    if (text(offset, 4) === 'fmt ') validFormat = pcm16Mono16k(view, start, size);

    if (text(offset, 4) === 'data') {
      if (!validFormat || size % 2) throw new Error('Unsupported WAV fixture format');

      return Float32Array.from(
        { length: size / 2 },
        (_, index) => view.getInt16(start + index * 2, true) / 32_768
      );
    }

    offset = start + size + (size % 2);
  }

  throw new Error('WAV fixture has no samples');
}
