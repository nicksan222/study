/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Canonicalizes transient provider blocks and report targets for derivative          │
 * │ Documents.                                                                               │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Preserves proven unchanged target blocks; assigns fresh IDs to new content.            │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Native generation activities own execution; Materials validates and                      │
 * │ publishes canonical results.                                                             │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import type { documentTransformOutputSchema } from '@study/contracts/ai/document-transform';
import { StudyError } from '@study/contracts/errors';
import { createBlock } from '@study/contracts/sources/document';
import type { Block } from '@study/contracts/sources/document';
import { blockContentSchema } from '@study/contracts/sources/schemas';
import { Schema } from 'effect';

import { canonicalJson } from './edit-intent.ts';

type Output = typeof documentTransformOutputSchema.Type;

export function canonicalDocumentTransformOutput(
  output: Output,
  targetBlocks: readonly Block[] = []
) {
  const unchanged = new Map<string, Block[]>();

  for (const block of targetBlocks) {
    const key = contentIdentity(block.content);
    const candidates = unchanged.get(key) ?? [];

    candidates.push(block);
    unchanged.set(key, candidates);
  }

  const blocks = output.blocks.map((encoded) => {
    const content = Schema.decodeUnknownSync(Schema.toCodecJson(blockContentSchema))(encoded);
    // Consume each exact match once; duplicate content follows captured target order.
    const original = unchanged.get(contentIdentity(content))?.shift();

    return createBlock(content, { type: 'authored' }, original?.id);
  });
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

function contentIdentity(content: Block['content']) {
  return canonicalJson(
    JSON.stringify(Schema.encodeSync(Schema.toCodecJson(blockContentSchema))(content))
  );
}
