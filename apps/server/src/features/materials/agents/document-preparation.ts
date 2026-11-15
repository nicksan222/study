/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Declares material study-note semantics and bounded document preparation policy.    │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Selects concept extraction and reduction agents and prompts.                           │
 * │ - Declares original marker rendering and preparation budgets.                            │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ The shared AI platform owns traversal, checkpoints, provenance and final evidence scope. │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { materialStudyNotesSchema } from '@study/contracts/ai/material-study-notes';
import { contentInputSchema } from '@study/contracts/inputs';

import { studyNotesAgent } from '#server/features/materials/agents/study-notes';
import { defineDocumentPreparation } from '#server/platform/ai/document-processing/index';

export const materialDocumentPreparation = defineDocumentPreparation({
  name: 'materials-study-notes-v1',
  referenceSchema: contentInputSchema,
  mappedSchema: materialStudyNotesSchema,
  direct: { empty: { notes: [] } },
  map: {
    agent: studyNotesAgent,
    instruction: (task: string) => `Extract study notes for this material request.\n${task}`
  },
  reduce: {
    agent: studyNotesAgent,
    instruction: (task: string) =>
      `Reduce study notes into a compact, varied concept set for one final material. Preserve original markers.\n${task}`
  },
  markers: (value) => value.notes.flatMap((note) => note.markers),
  render: (value) =>
    value.notes
      .map((note) => `${note.text} ${note.markers.map((marker) => `[${marker}]`).join(' ')}`)
      .join('\n'),
  planLimits: {
    maxPassageChars: 1000,
    maxPieceChars: 16_000,
    maxPieceBytes: 60_000,
    maxPlanChars: 1_000_000,
    maxPlanBytes: 8_000_000,
    maxPieces: 128
  },
  limits: { maxResultBytes: 48_000, maxReductionBytes: 96_000, maxFanout: 2, maxLevels: 8 },
  promptLimits: { maxBytes: 256_000, reservedBytes: 128_000 }
});
