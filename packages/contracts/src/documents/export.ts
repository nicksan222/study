import { Schema } from 'effect';

import { exportOmissionSchema, MAX_EXPORT_BYTES } from '../exports.ts';
import { studyDocumentVersionIdSchema } from '../ids.ts';
const documentExportFormatSchema = Schema.Literals(['markdown', 'html']);
export const exportDocumentInputSchema = Schema.Struct({
  id: studyDocumentVersionIdSchema,
  format: documentExportFormatSchema
});
export const documentFileSchema = Schema.Struct({
  versionId: studyDocumentVersionIdSchema,
  format: documentExportFormatSchema,
  filename: Schema.String,
  mediaType: Schema.Literals(['text/markdown; charset=utf-8', 'text/html; charset=utf-8']),
  bytes: Schema.Uint8Array.check(Schema.makeFilter((bytes) => bytes.length <= MAX_EXPORT_BYTES)),
  omissions: Schema.Array(exportOmissionSchema)
});
