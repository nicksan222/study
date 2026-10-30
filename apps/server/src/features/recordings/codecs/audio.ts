import { StudyError } from '@study/contracts/errors';

export const MAX_RECORDING_SAMPLES = 16000 * 60 * 60;

export const MAX_RECORDING_CHUNK_SAMPLES = 16000 * 60;

/** Encode already validated little-endian signed PCM in the recording format. */
export function encodeRecordingWav(chunks: readonly Uint8Array[]): Uint8Array {
  let size = 0;

  for (const chunk of chunks) {
    if (chunk.byteLength === 0 || chunk.byteLength % 2 !== 0)
      throw new StudyError('invalid_input', 'recording PCM is invalid');

    size += chunk.byteLength;

    if (size > MAX_RECORDING_SAMPLES * 2)
      throw new StudyError('invalid_input', 'recording is too large');
  }

  if (size === 0) throw new StudyError('invalid_input', 'recording is empty');

  const wav = Buffer.alloc(44 + size);

  wav.write('RIFF', 0);
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(16000, 24);
  wav.writeUInt32LE(32000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(size, 40);
  let offset = 44;

  for (const chunk of chunks) {
    wav.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return wav;
}
