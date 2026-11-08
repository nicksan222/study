import { Schema } from 'effect';

import { pageIdSchema, pageVersionIdSchema, projectIdSchema, noteIdSchema } from '../ids.ts';
import { documentBlockDifferenceSchema } from '../sources/schemas.ts';
import {
  authoredContentSchema,
  exactInputSchema,
  citationSchema,
  versionSchema
} from './schemas.ts';

export const keySchema = Schema.String.check(Schema.isBetweenLength(1, 200));

export const createSchema = Schema.Struct({
  createKey: keySchema,
  title: Schema.Trim.check(Schema.isBetweenLength(1, 200)),
  document: authoredContentSchema,
  inputs: Schema.Array(exactInputSchema).check(Schema.isMaxLength(1000)),
  citations: Schema.Array(citationSchema).check(Schema.isMaxLength(10000)),
  projectId: Schema.optional(projectIdSchema),
  noteId: Schema.optional(noteIdSchema)
});

export const saveSchema = Schema.Struct({
  pageId: pageIdSchema,
  expectedVersionId: pageVersionIdSchema,
  key: keySchema,
  document: authoredContentSchema
});

export const restoreSchema = Schema.Struct({
  pageId: pageIdSchema,
  expectedVersionId: pageVersionIdSchema,
  restoreVersionId: pageVersionIdSchema,
  key: keySchema
});

export const editOutcomeSchema = Schema.Struct({
  outcome: Schema.Literals(['saved', 'conflict']),
  replayed: Schema.Boolean,
  expectedVersionId: pageVersionIdSchema,
  currentVersionId: pageVersionIdSchema,
  submittedVersionId: pageVersionIdSchema
});

export const compareSchema = Schema.Struct({
  beforeVersionId: pageVersionIdSchema,
  proposedVersionId: pageVersionIdSchema,
  currentVersionId: pageVersionIdSchema
});

export const blockDifferenceSchema = documentBlockDifferenceSchema;

export const comparisonSchema = Schema.Struct({
  ...compareSchema.fields,
  before: versionSchema,
  proposed: versionSchema,
  current: versionSchema,
  proposedChanges: Schema.Array(blockDifferenceSchema),
  currentChanges: Schema.Array(blockDifferenceSchema),
  evidence: Schema.Literal('structural_only')
});

export const publishSchema = Schema.Struct({
  requestId: keySchema,
  pageId: pageIdSchema,
  expectedVersionId: pageVersionIdSchema,
  key: keySchema,
  document: authoredContentSchema,
  inputs: Schema.Array(exactInputSchema),
  citations: Schema.Array(citationSchema),
  operation: Schema.Literals(['summarize', 'translate', 'generate']),
  instruction: Schema.String.check(Schema.isBetweenLength(1, 100000)),
  language: Schema.NullOr(Schema.String)
});

/** Publication of an independent generated output has no expected authored base. */
export const createGeneratedSchema = Schema.Struct({
  requestId: keySchema,
  title: createSchema.fields.title,
  document: authoredContentSchema,
  inputs: createSchema.fields.inputs,
  citations: createSchema.fields.citations,
  operation: publishSchema.fields.operation,
  instruction: publishSchema.fields.instruction,
  language: publishSchema.fields.language,
  projectId: Schema.optional(projectIdSchema),
  noteId: Schema.optional(noteIdSchema)
});

export const createGeneratedOutcomeSchema = Schema.Struct({
  pageId: pageIdSchema,
  version: versionSchema,
  replayed: Schema.Boolean
});

export const proposalKeySchema = Schema.Struct({ requestId: keySchema });

export const proposalSchema = Schema.Struct({
  ...proposalKeySchema.fields,
  pageId: pageIdSchema,
  baseVersionId: pageVersionIdSchema,
  proposedVersionId: pageVersionIdSchema,
  currentVersionId: pageVersionIdSchema
});

export const applyProposalSchema = Schema.Struct({
  ...proposalKeySchema.fields,
  key: keySchema,
  expectedVersionId: pageVersionIdSchema
});

export const keepProposalSchema = Schema.Struct({
  ...proposalKeySchema.fields,
  key: keySchema,
  title: createSchema.fields.title
});

export const proposalOutcomeSchema = Schema.Struct({
  ...proposalKeySchema.fields,
  outcome: Schema.Literals(['applied', 'kept', 'conflict']),
  baseVersionId: pageVersionIdSchema,
  proposedVersionId: pageVersionIdSchema,
  currentVersionId: pageVersionIdSchema,
  resultVersionId: Schema.NullOr(pageVersionIdSchema),
  replayed: Schema.Boolean
});
