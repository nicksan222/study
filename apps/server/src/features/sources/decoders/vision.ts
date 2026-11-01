/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Converts ordered vision transcription pages and blocks into the canonical anchored │
 * │ document representation.                                                                 │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Source decoders convert bounded input bytes into canonical document data.              │
 * │ - Validates format input and constructs decoded content.                                 │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Does not choose ingestion policy or persist source state.                                │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import type { visionTranscriptionOutputSchema } from '@study/contracts/ai/vision-transcription';
import { StudyError } from '@study/contracts/errors';
import { plainBlock } from '@study/contracts/sources/document';
import type { Document } from '@study/contracts/sources/document';

export function visionDocument(
  pages: typeof visionTranscriptionOutputSchema.Type.pages,
  pageCount: number
): Document {
  if (pages.length !== pageCount || pages.some((page, index) => page.page !== index + 1))
    throw new StudyError('invalid_input', 'The model did not transcribe every page in order');

  return {
    blocks: pages.flatMap((page) =>
      page.blocks.map((block) =>
        plainBlock(block.kind, block.text, { type: 'page', page: page.page })
      )
    ),
    meta: {
      extractor: 'vision',
      extractorVersion: 1,
      provider: 'chatgpt',
      durationMs: null,
      pageCount,
      refiners: [],
      waitingFor: [],
      corrected: false,
      omissions: ['provider_structure', 'layout', 'embedded_media']
    }
  };
}
