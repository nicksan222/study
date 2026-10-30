import type { visionTranscriptionOutputSchema } from '@study/contracts/ai/vision-transcription';
import { StudyError } from '@study/contracts/errors';
import type { Document } from '@study/contracts/sources/document';

export function visionDocument(
  pages: typeof visionTranscriptionOutputSchema.Type.pages,
  pageCount: number
): Document {
  if (pages.length !== pageCount || pages.some((page, index) => page.page !== index + 1))
    throw new StudyError('invalid_input', 'The model did not transcribe every page in order');

  return {
    blocks: pages.flatMap((page) =>
      page.blocks.map((block) => ({
        ...block,
        anchor: { type: 'page' as const, page: page.page }
      }))
    ),
    meta: {
      extractor: 'vision',
      extractorVersion: 1,
      provider: 'chatgpt',
      durationMs: null,
      pageCount,
      refiners: [],
      waitingFor: [],
      corrected: false
    }
  };
}
