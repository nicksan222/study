/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Exposes bounded document planning and durable processing to server features.       │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Publishes reusable plan schemas, typed views and processing callbacks.                 │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Feature modules retain ownership of model prompts and final publication authority.       │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

export { planDocumentPieces, splitTextRanges, documentPiecePlanSchema } from './planner.ts';
export type {
  DocumentInput,
  DocumentPiece,
  DocumentPiecePlan,
  DocumentPlanLimits,
  DocumentSelection
} from './planner.ts';
export { processDocumentPieces } from './runner.ts';
export type { DocumentProcessingLimits, ReductionContext } from './runner.ts';
