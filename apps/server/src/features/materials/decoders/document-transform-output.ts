/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Canonicalizes transient provider blocks and report targets for derivative          │
 * │ Documents.                                                                               │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Decodes canonical block content and assigns fresh authored block identities.           │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Native generation activities own execution; Materials validates and publishes canonical  │
 * │ results.                                                                                 │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import type { documentTransformOutputSchema } from '@study/contracts/ai/document-transform';
import { StudyError } from '@study/contracts/errors';
import { createBlock } from '@study/contracts/sources/document';
import { blockContentSchema } from '@study/contracts/sources/schemas';
import { Schema } from 'effect';

type Output = typeof documentTransformOutputSchema.Type;

export function canonicalDocumentTransformOutput(output: Output) {
  const blocks = output.blocks.map((content) =>
    createBlock(Schema.decodeUnknownSync(Schema.toCodecJson(blockContentSchema))(content))
  );
  const report = {
    notes: output.notes.map(({ blockOrdinals, ...note }) => ({
      ...note,
      blockIds: blockOrdinals.map((ordinal) => {
        const block = blocks[ordinal];

        if (!block) throw new StudyError('invalid_input', 'Report block is unavailable');

        return block.id;
      })
    }))
  };

  return {
    content: {
      kind: 'document' as const,
      blocks,
      meta: {
        extractor: null,
        extractorVersion: 1,
        provider: null,
        durationMs: null,
        pageCount: null,
        refiners: [],
        waitingFor: [],
        corrected: false,
        omissions: []
      }
    },
    report
  };
}
