import { Schema } from 'effect';

import { errorKindSchema } from '../errors.ts';
import { projectIdSchema, noteIdSchema, pageVersionIdSchema } from '../ids.ts';
import { runSelectionContextSchema } from '../notes/context.ts';
import { blockIdSchema } from '../sources/schemas.ts';
import { authoredContentSchema, citationSchema } from './schemas.ts';

const transformOperationsSchema = Schema.Array(
  Schema.Literals([
    'clarity',
    'grammar',
    'structure',
    'combine',
    'deduplicate',
    'summarize',
    'explain',
    'expand',
    'translate',
    'factual_correction'
  ])
).check(
  Schema.isBetweenLength(1, 10),
  Schema.makeFilter((operations) => new Set(operations).size === operations.length)
);

export const transformRequestSchema = Schema.Struct({
  contextRequestId: Schema.String.check(Schema.isMinLength(1)),
  title: Schema.Trim.check(Schema.isBetweenLength(1, 200)),
  operations: transformOperationsSchema,
  editTargetVersionId: Schema.optional(pageVersionIdSchema)
});

export const transformReportSchema = Schema.Struct({
  notes: Schema.Array(
    Schema.Struct({
      kind: Schema.Literals([
        'addition',
        'omission',
        'conflict',
        'uncertainty',
        'correction_proposal',
        'limit'
      ]),
      explanation: Schema.Trim.check(Schema.isBetweenLength(1, 4000)),
      blockIds: Schema.Array(blockIdSchema).check(Schema.isMaxLength(200))
    })
  ).check(Schema.isBetweenLength(1, 200))
});

export const transformKeySchema = Schema.Struct({ requestId: Schema.String });

export const mergeRequestSchema = Schema.Struct({
  key: Schema.String.check(Schema.isBetweenLength(1, 100)),
  title: transformRequestSchema.fields.title,
  versions: Schema.Array(pageVersionIdSchema).check(
    Schema.isBetweenLength(2, 20),
    Schema.makeFilter((versions) => new Set(versions).size === versions.length)
  ),
  instruction: Schema.String.check(Schema.isMaxLength(10000)),
  language: Schema.Literals(['english', 'italian']),
  projectId: Schema.optional(projectIdSchema)
});

/** Note captures and standalone page captures share the generation contract. */
export const pageTransformContextSchema = Schema.Struct({
  ...runSelectionContextSchema.fields,
  noteId: Schema.NullOr(noteIdSchema)
});

export const storedTransformRequestSchema = Schema.Struct({
  ...transformRequestSchema.fields,
  merge: Schema.optional(mergeRequestSchema)
});

export const transformSnapshotSchema = Schema.Struct({
  id: Schema.String,
  ...storedTransformRequestSchema.fields,
  noteId: Schema.NullOr(noteIdSchema),
  eventId: Schema.String,
  instruction: Schema.String,
  cancelled: Schema.Boolean,
  errorKind: Schema.NullOr(errorKindSchema),
  resultVersionId: Schema.NullOr(pageVersionIdSchema),
  report: Schema.NullOr(transformReportSchema)
});

export const transformPublicationSchema = Schema.Struct({
  ...transformKeySchema.fields,
  generationEventId: Schema.String,
  document: authoredContentSchema,
  report: transformReportSchema,
  citations: Schema.Array(citationSchema),
  language: Schema.optional(Schema.String)
});
