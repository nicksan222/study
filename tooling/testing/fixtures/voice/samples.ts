/** Human FLEURS recordings; source, license and unmodified file hashes are in attribution.json. */
export const voiceSamples = [
  {
    id: 'it_it_0228',
    language: 'it',
    reference: 'non serve per forza uno yacht per gli arcipelaghi e i laghi',
    // The French sample has one known recognition substitution; Italian and English are exact.
    maximumWordErrors: 0
  },
  {
    id: 'en_us_0165',
    language: 'en',
    reference: 'television reports show white smoke coming from the plant',
    maximumWordErrors: 0
  },
  {
    id: 'fr_fr_0226',
    language: 'fr',
    reference:
      "de grandes zones plus au nord sont assez peu peuplées et certaines sont presque inhabitées à l'état sauvage",
    maximumWordErrors: 1
  }
] as const;

function voiceSamplePath(id: (typeof voiceSamples)[number]['id']) {
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
export async function voiceSamplePcm(id: (typeof voiceSamples)[number]['id']) {
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
