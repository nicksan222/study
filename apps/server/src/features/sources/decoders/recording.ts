import { StudyError } from '@study/contracts/errors';

export function validateRecordingImport(input: {
  readonly requestId: string;
  readonly name: string;
  readonly bytes: Uint8Array;
  readonly durationMs: number;
}) {
  const b = Buffer.from(input.bytes);

  if (
    !input.requestId.trim() ||
    input.requestId.length > 256 ||
    !input.name.trim() ||
    input.name.length > 1024 ||
    !Number.isSafeInteger(input.durationMs) ||
    input.durationMs < 0 ||
    input.durationMs > 3600000 ||
    b.length < 46 ||
    b.length > 44 + 16000 * 60 * 60 * 2 ||
    b.toString('ascii', 0, 4) !== 'RIFF' ||
    b.readUInt32LE(4) !== b.length - 8 ||
    b.toString('ascii', 8, 16) !== 'WAVEfmt ' ||
    b.readUInt32LE(16) !== 16 ||
    b.readUInt16LE(20) !== 1 ||
    b.readUInt16LE(22) !== 1 ||
    b.readUInt32LE(24) !== 16000 ||
    b.readUInt32LE(28) !== 32000 ||
    b.readUInt16LE(32) !== 2 ||
    b.readUInt16LE(34) !== 16 ||
    b.toString('ascii', 36, 40) !== 'data' ||
    b.readUInt32LE(40) !== b.length - 44 ||
    (b.length - 44) % 2 !== 0 ||
    Math.round((b.length - 44) / 32) !== input.durationMs
  )
    throw new StudyError('invalid_input', 'invalid recording import');
}
