/** Exact readable content inputs shared by captures and learning artifacts. */
import { Schema } from 'effect';

import { contentSnapshotIdSchema, sourceIdSchema, pageVersionIdSchema } from './ids.ts';
import { blockIdSchema, documentSchema } from './sources/schemas.ts';

const authoredVersionInputSchema = Schema.Struct({
  kind: Schema.Literal('page'),
  versionId: pageVersionIdSchema
});

const extractedSourceInputSchema = Schema.Struct({
  kind: Schema.Literal('source'),
  sourceId: sourceIdSchema,
  revision: Schema.BigInt.check(Schema.isGreaterThanBigInt(0n)),
  snapshotId: contentSnapshotIdSchema
});

export const contentInputSchema = Schema.Union([
  authoredVersionInputSchema,
  extractedSourceInputSchema
]);

export type ContentInput = typeof contentInputSchema.Type;

export function contentInputKey(input: ContentInput): string {
  return input.kind === 'page'
    ? `page:${input.versionId}`
    : `source:${input.sourceId}:${input.revision}:${input.snapshotId}`;
}

export const contentRangeSchema = Schema.Struct({
  blockId: blockIdSchema,
  start: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  end: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
}).check(Schema.makeFilter((range) => range.end >= range.start));

export const resolvedContentInputSchema = Schema.Struct({
  input: contentInputSchema,
  snapshotId: contentSnapshotIdSchema,
  name: Schema.String,
  document: documentSchema
});
