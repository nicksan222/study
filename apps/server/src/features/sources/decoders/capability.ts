/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Routes recognized source content to supported ingestion decoder paths.             │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Matches source kinds and MIME types to local decoder implementations.                  │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Recognition does not grant processing support or invoke external model providers.        │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

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

  if (officePath(input)) return 'office';

  if (visionPath(input)) return 'vision';

  return 'none';
}

function officePath(input: { kind: SourceKind; mime: string }) {
  return (
    (input.kind === 'document' &&
      input.mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') ||
    (input.kind === 'slides' &&
      input.mime === 'application/vnd.openxmlformats-officedocument.presentationml.presentation')
  );
}

function visionPath(input: { kind: SourceKind; mime: string }) {
  return (
    (input.kind === 'pdf' && input.mime === 'application/pdf') ||
    (input.kind === 'image' &&
      ['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(input.mime))
  );
}
