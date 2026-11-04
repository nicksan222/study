import { Schema } from 'effect';

import { errorKindSchema } from '../errors.ts';
import { sessionIdSchema, studyDocumentVersionIdSchema } from '../ids.ts';
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
  editTargetVersionId: Schema.optional(studyDocumentVersionIdSchema)
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

export const transformSnapshotSchema = Schema.Struct({
  id: Schema.String,
  ...transformRequestSchema.fields,
  sessionId: Schema.NullOr(sessionIdSchema),
  eventId: Schema.String,
  instruction: Schema.String,
  cancelled: Schema.Boolean,
  errorKind: Schema.NullOr(errorKindSchema),
  resultVersionId: Schema.NullOr(studyDocumentVersionIdSchema),
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
