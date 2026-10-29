import { Schema } from 'effect';

import { anchorSchema } from '#server/shared/sources/schemas';
import { sourceKinds } from '#server/shared/sources/sniff';

export { anchorSchema };

export const searchHitSchema = Schema.Struct({
  kind: Schema.Literals(['project', 'session', 'message', 'source']),
  title: Schema.String,
  at: Schema.BigInt,
  context: Schema.optional(Schema.String),
  excerpt: Schema.optional(Schema.String),
  fileKind: Schema.optional(Schema.Literals(sourceKinds)),
  target: Schema.Union([
    Schema.Struct({
      type: Schema.Literal('project'),
      id: Schema.BigInt
    }),
    Schema.Struct({
      type: Schema.Literal('session'),
      projectId: Schema.BigInt,
      sessionId: Schema.BigInt
    }),
    Schema.Struct({
      type: Schema.Literal('source'),
      sourceId: Schema.BigInt,
      anchor: Schema.optional(anchorSchema)
    })
  ])
});

export const searchResultSchema = Schema.Struct({
  semantic: Schema.Boolean,
  hits: Schema.Array(searchHitSchema)
});
