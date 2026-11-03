/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Defines canonical guarded Document editing and proposal contracts.               │
 * │                                                                                        │
 * │ Responsibilities:                                                                      │
 * │ - Exposes schema-derived inputs, outcomes and rich structural differences.             │
 * │                                                                                        │
 * │ Boundaries:                                                                            │
 * │ Browser-safe contracts contain no persistence or execution behavior.                   │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { Schema } from 'effect';

import {
  materialIdSchema,
  materialVersionIdSchema,
  projectIdSchema,
  sessionIdSchema
} from '../ids.ts';
import { blockSchema } from '../sources/schemas.ts';
import { materialDocumentSchema, materialVersionDetailSchema } from './schemas.ts';

export const saveDocumentInputSchema = Schema.Struct({
  materialId: materialIdSchema,
  expectedVersionId: materialVersionIdSchema,
  saveKey: Schema.String.check(Schema.isBetweenLength(1, 200)),
  document: materialDocumentSchema
});

export const documentEditOutcomeSchema = Schema.Struct({
  outcome: Schema.Literals(['saved', 'conflict']),
  replayed: Schema.Boolean,
  expectedVersionId: materialVersionIdSchema,
  currentVersionId: materialVersionIdSchema,
  submittedVersionId: materialVersionIdSchema
});

export const compareDocumentInputSchema = Schema.Struct({
  beforeVersionId: materialVersionIdSchema,
  proposedVersionId: materialVersionIdSchema,
  currentVersionId: materialVersionIdSchema
});

export const documentBlockDifferenceSchema = Schema.Struct({
  kind: Schema.Literals(['inserted', 'removed', 'changed', 'moved']),
  blockId: blockSchema.fields.id,
  beforeOrdinal: Schema.NullOr(Schema.Int),
  afterOrdinal: Schema.NullOr(Schema.Int),
  before: Schema.NullOr(blockSchema),
  after: Schema.NullOr(blockSchema)
});

export const documentComparisonSchema = Schema.Struct({
  ...compareDocumentInputSchema.fields,
  before: materialVersionDetailSchema,
  proposed: materialVersionDetailSchema,
  current: materialVersionDetailSchema,
  proposedChanges: Schema.Array(documentBlockDifferenceSchema),
  currentChanges: Schema.Array(documentBlockDifferenceSchema),
  evidence: Schema.Literal('structural_only')
});

export const undoDocumentInputSchema = Schema.Struct({
  materialId: materialIdSchema,
  expectedVersionId: materialVersionIdSchema,
  restoreVersionId: materialVersionIdSchema,
  undoKey: Schema.String.check(Schema.isBetweenLength(1, 200))
});

export const proposalKeySchema = Schema.Struct({
  requestId: Schema.String.check(Schema.isMinLength(1))
});

export const applyDocumentProposalSchema = Schema.Struct({
  ...proposalKeySchema.fields,
  key: Schema.String.check(Schema.isBetweenLength(1, 200)),
  expectedVersionId: materialVersionIdSchema,
  baseVersionId: materialVersionIdSchema
});

export const keepDocumentProposalSchema = Schema.Struct({
  ...proposalKeySchema.fields,
  projectId: Schema.optional(projectIdSchema),
  key: Schema.String.check(Schema.isBetweenLength(1, 200))
});

export const documentProposalOutcomeSchema = Schema.Struct({
  requestId: Schema.String,
  outcome: Schema.Literals(['applied', 'kept', 'conflict']),
  baseVersionId: materialVersionIdSchema,
  proposedVersionId: materialVersionIdSchema,
  currentVersionId: materialVersionIdSchema,
  resultVersionId: Schema.NullOr(materialVersionIdSchema),
  replayed: Schema.Boolean
});

/** An imported source can be supplied as an exact input; this creates its authored derivative. */

export const createManualDocumentSchema = Schema.Struct({
  createKey: Schema.optional(Schema.String.check(Schema.isBetweenLength(1, 200))),
  title: Schema.Trim.check(Schema.isBetweenLength(1, 200)),
  document: materialDocumentSchema,
  inputVersionId: Schema.optional(materialVersionIdSchema),
  projectId: Schema.optional(projectIdSchema),
  sessionId: Schema.optional(sessionIdSchema)
});
