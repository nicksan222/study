import { Schema } from 'effect';

import { exportOmissionSchema, MAX_EXPORT_BYTES } from '../exports.ts';
import { pageVersionIdSchema } from '../ids.ts';

const pageExportFormatSchema = Schema.Literals(['markdown', 'html']);

export const exportPageInputSchema = Schema.Struct({
  id: pageVersionIdSchema,
  format: pageExportFormatSchema
});

export const pageFileSchema = Schema.Struct({
  versionId: pageVersionIdSchema,
  format: pageExportFormatSchema,
  filename: Schema.String,
  mediaType: Schema.Literals(['text/markdown; charset=utf-8', 'text/html; charset=utf-8']),
  bytes: Schema.Uint8Array.check(Schema.makeFilter((bytes) => bytes.length <= MAX_EXPORT_BYTES)),
  omissions: Schema.Array(exportOmissionSchema)
});
