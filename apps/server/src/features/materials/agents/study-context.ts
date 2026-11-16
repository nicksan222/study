/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Declares material study-note semantics and bounded context preparation policy.     │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Selects concept extraction and reduction agents and prompts.                           │
 * │ - Declares original marker rendering and context semantics.                              │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ The shared AI platform owns traversal, checkpoints, provenance and final evidence scope. │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { defineContextPreparation } from '@study/server';

import { studyNotesAgent } from '#server/features/materials/agents/study-notes';

export const materialStudyContext = defineContextPreparation({
  name: 'materials-study-notes-v1',
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
      .join('\n')
});
