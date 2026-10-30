import { Schema } from 'effect';

import { sourceSchema } from './schemas.ts';

export type Source = typeof sourceSchema.Type;

export const newSourceSchema = Schema.Struct({
  name: sourceSchema.fields.name,
  kind: sourceSchema.fields.kind,
  mime: sourceSchema.fields.mime,
  origin: sourceSchema.fields.origin,
  projectId: Schema.optional(sourceSchema.fields.projectId),
  uri: Schema.optional(sourceSchema.fields.uri),
  bytes: Schema.instanceOf(Uint8Array)
});

export type NewSource = typeof newSourceSchema.Type;
