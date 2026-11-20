import { Schema } from 'effect';

import { sourceIdSchema } from '../ids.ts';
import type { Detected } from './sniff.ts';

export function isDelimitedSource({ kind, mime }: Detected) {
  return kind === 'spreadsheet' && (mime === 'text/csv' || mime === 'text/tab-separated-values');
}

export const sourcePreviewInputSchema = Schema.Struct({ id: sourceIdSchema });

export const sourcePreviewSchema = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal('unavailable'),
    reason: Schema.Literals(['size', 'invalid', 'unsupported'])
  }),
  Schema.Struct({
    kind: Schema.Literal('table'),
    columns: Schema.Int,
    rows: Schema.Array(Schema.Array(Schema.String)),
    limited: Schema.Boolean
  })
]);

export type SourcePreview = typeof sourcePreviewSchema.Type;
