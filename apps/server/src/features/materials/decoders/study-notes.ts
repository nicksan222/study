/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Validates bounded derived notes and resolves final material citations against      │
 * │ originals.                                                                               │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Rejects markers absent from their accepted input scope.                                │
 * │ - Bounds feature prompts and searches canonical original passages.                       │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ The accepted shared plan owns original identity; derived notes never become evidence.    │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { materialStudyNotesSchema } from '@study/contracts/ai/material-study-notes';
import { StudyError } from '@study/contracts/errors';
import type { ContentInput } from '@study/contracts/inputs';
import { Effect, Schema } from 'effect';

import type { DocumentPiecePlan } from '#server/platform/ai/document-processing/index';
import { createPassageEvidenceCatalog } from '#server/platform/ai/evidence';

export const studyNotesSchema = materialStudyNotesSchema;

export type StudyNotes = typeof studyNotesSchema.Type;

export function validateStudyNotes(notes: StudyNotes, allowed: ReadonlySet<number>) {
  return Effect.try({
    try: () => {
      const validated = Schema.decodeUnknownSync(studyNotesSchema)(notes);

      if (
        validated.notes.length === 0 ||
        validated.notes.some((note) => note.markers.some((marker) => !allowed.has(marker)))
      )
        throw new StudyError('invalid_input', 'Derived notes cite unavailable original evidence');

      return validated;
    },
    catch: (cause) =>
      cause instanceof StudyError
        ? cause
        : new StudyError('invalid_input', 'Invalid derived study notes', { cause })
  });
}

/** Bound the serialized feature prompt, reserving room for agent schemas and instructions. */
export function boundedMaterialPrompt(prompt: string) {
  return new TextEncoder().encode(JSON.stringify({ prompt })).byteLength <= 120_000
    ? Effect.succeed(prompt)
    : Effect.fail(
        new StudyError('not_enough', 'Material generation prompt exceeds the declared budget')
      );
}

export function originalMaterialEvidence(
  plan: DocumentPiecePlan<ContentInput>,
  markers?: ReadonlySet<number>
) {
  const entries = plan.pieces
    .flatMap((piece) => piece.passages)
    .filter((passage) => !markers || markers.has(passage.marker));
  const catalog = createPassageEvidenceCatalog(
    entries.map((entry) => ({
      marker: entry.marker,
      name: entry.name.slice(0, 200),
      quote: entry.text,
      blockOrdinal: entry.ordinal,
      reference: {
        input: entry.reference,
        target: { blockId: entry.blockId, start: entry.start, end: entry.end }
      }
    })),
    { initiallyExposed: true }
  );

  return {
    search: catalog.search,
    citations: (text: string) =>
      catalog.citations(text).map(({ marker, reference, ...rest }) => ({
        marker: BigInt(marker),
        ...reference,
        ...rest
      }))
  };
}
