/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Converts PDF pages and pasted text with the configured AI model provider.          │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Prepares faithful transcription inputs and validates ordered page outputs.             │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Workflow activities supply model execution and own retries and publication.              │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { StudyError } from '@study/contracts/errors';
import { Effect } from 'effect';

import { pdfConversionAgent } from '#server/features/sources/agents/pdf-text-conversion';
import { textConversionAgent } from '#server/features/sources/agents/text-conversion';
import { decodePdf } from '#server/features/sources/decoders/pdf';
import { decodeText } from '#server/features/sources/decoders/text';
import { visionDocument } from '#server/features/sources/decoders/vision';

import type { ConversionStrategy } from './registry.ts';

export const chatGptConversion: ConversionStrategy = {
  id: 'chatgpt',
  label: 'ConversionChatGpt',
  supportedInputs: ['text', 'pdf'],
  convert: Effect.fnUntraced(function* (input, context) {
    if (input.kind === 'text') {
      const output = yield* context.generate(textConversionAgent, { text: input.text });

      return decodeText({
        bytes: new TextEncoder().encode(output),
        kind: 'text',
        mime: 'text/markdown'
      });
    }

    const pageCount = yield* Effect.tryPromise({
      try: () => decodePdf(input.bytes),
      catch: (cause) =>
        cause instanceof StudyError
          ? cause
          : new StudyError('invalid_input', 'Cannot read PDF', { cause })
    });
    const output = yield* context.generate(pdfConversionAgent, {
      prompt: `Transcribe all ${pageCount} page(s) in order.`,
      data: input.bytes,
      mediaType: 'application/pdf'
    });

    return yield* Effect.try({
      try: () => visionDocument(output.pages, pageCount),
      catch: (cause) =>
        cause instanceof StudyError
          ? cause
          : new StudyError('invalid_input', 'Invalid PDF transcription', { cause })
    });
  })
};
