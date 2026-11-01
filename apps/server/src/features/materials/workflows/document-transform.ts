/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Generates canonical derivative Documents from immutable session context.           │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Restricts provider evidence and constructs fresh authored blocks.                      │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Native generation activities own execution; Materials participants validate and publish  │
 * │ results.                                                                                 │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import type { runSelectionContextSchema } from '@study/contracts/conversations/context';
import { StudyError } from '@study/contracts/errors';
import type { MaterialVersionId } from '@study/contracts/ids';
import type { materialGenerationSnapshotSchema } from '@study/contracts/materials/schemas';
import { createBlock } from '@study/contracts/sources/document';
import { blockContentSchema } from '@study/contracts/sources/schemas';
import type { documentTextRangeSchema } from '@study/contracts/sources/schemas';
import { Effect, Schema } from 'effect';

import { documentTransformAgent } from '#server/features/materials/agents/document-transform';
import type { documentTransformOutputSchema } from '#server/features/materials/agents/document-transform';
import {
  validateDocumentTransform,
  authorizedTransformAssets
} from '#server/features/materials/decoders/document-transform';
import { Agents, generateAgent } from '#server/platform/ai/agents';
import { createEvidenceCatalog } from '#server/platform/ai/evidence';

type Captured = typeof runSelectionContextSchema.Type;
type Request = typeof materialGenerationSnapshotSchema.Type;
type Output = typeof documentTransformOutputSchema.Type;

export function generateDocumentTransform(input: {
  context: Captured;
  request: Request;
  eventId: string;
  preflight: Effect.Effect<void, StudyError>;
}) {
  return Effect.gen(function* () {
    const agents = yield* Agents;
    const { context, request } = input;
    const catalog = createEvidenceCatalog<{
      inputVersionId: MaterialVersionId;
      target: typeof documentTextRangeSchema.Type;
    }>([]);
    for (const input of context.inputs)
      for (const [index, excerpt] of input.excerpts.entries())
        catalog.addDocument({
          key: `${input.versionId}:${index}`,
          name: input.name,
          reference: {
            inputVersionId: input.versionId,
            target: {
              versionId: input.versionId,
              documentId: input.documentId,
              blockId: excerpt.blockId,
              start: excerpt.start,
              end: excerpt.end
            }
          },
          quoteLimit: 100000,
          blocks: [{ text: excerpt.text, blockOrdinal: excerpt.blockOrdinal }]
        });
    const captured = {
      title: request.title,
      operations: request.documentTransform?.operations,
      instruction: context.instruction,
      preferences: context.preferences,
      assets: authorizedTransformAssets(context),
      messages: context.messages,
      excludedMessages: context.excludedMessages,
      inputs: context.inputs.map((target) => ({
        versionId: target.versionId,
        name: target.name,
        excerpts: target.excerpts
      }))
    };
    const output = yield* generateAgent(
      documentTransformAgent,
      {
        prompt: JSON.stringify(captured, (_, value: unknown) =>
          typeof value === 'bigint' ? String(value) : value
        )
      },
      { maxRetries: 0, preflight: input.preflight }
    ).pipe(
      Effect.provideService(Agents, {
        ...agents,
        searchSources: (query: string) => Effect.sync(() => catalog.search(query))
      })
    );
    return yield* Effect.try({
      try: () => {
        const content = canonicalOutput(output);
        const citations = catalog
          .citations(
            [
              ...content.content.blocks.map((block) => block.text),
              ...content.report.notes.map((note) => note.explanation)
            ].join('\n')
          )
          .map(({ marker, reference, ...citation }) => ({
            marker: BigInt(marker),
            ...reference,
            ...citation
          }));
        const publication = {
          ...content,
          requestId: request.id,
          generationEventId: input.eventId,
          language: context.preferences.language,
          citations
        };
        validateDocumentTransform(context, publication);
        return publication;
      },
      catch: (cause) =>
        cause instanceof StudyError
          ? cause
          : new StudyError('invalid_input', 'Invalid Document output', { cause })
    });
  });
}

function canonicalOutput(output: Output) {
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
