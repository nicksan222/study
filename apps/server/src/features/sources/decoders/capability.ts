/** Decoder routing shared with ingestion; recognition alone never grants processing support. */
import type { SourceKind } from '@study/contracts/sources/sniff';
export function decoderPath(input: { kind: SourceKind; mime: string }) {
  if (
    input.kind === 'web' ||
    (input.mime === 'text/html' && ['text', 'code', 'note'].includes(input.kind))
  )
    return 'html';
  if (
    ['text', 'code', 'note'].includes(input.kind) ||
    (input.kind === 'spreadsheet' && input.mime.startsWith('text/'))
  )
    return 'text';
  if (
    (input.kind === 'document' &&
      input.mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') ||
    (input.kind === 'slides' &&
      input.mime === 'application/vnd.openxmlformats-officedocument.presentationml.presentation')
  )
    return 'office';
  if (
    (input.kind === 'pdf' && input.mime === 'application/pdf') ||
    (input.kind === 'image' &&
      ['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(input.mime))
  )
    return 'vision';
  return 'none';
}
