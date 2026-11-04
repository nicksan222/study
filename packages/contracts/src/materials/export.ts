import { Schema } from 'effect';

import { exportOmissionSchema } from '../exports.ts';
import { materialVersionIdSchema } from '../ids.ts';
import { blockIdSchema } from '../sources/schemas.ts';
import { materialVersionDetailSchema, materialCitationSchema } from './schemas.ts';
export { exportFormatSchema, exportOmissionSchema, MAX_EXPORT_BYTES } from '../exports.ts';
export const learningExportFormatSchema = Schema.Literals(['aid_json', 'csv']);
export const exportMaterialVersionInputSchema = Schema.Struct({
  id: materialVersionIdSchema,
  format: learningExportFormatSchema
});
export const materialVersionFileSchema = Schema.Struct({
  versionId: materialVersionIdSchema,
  format: learningExportFormatSchema,
  filename: Schema.String,
  mediaType: Schema.Literals([
    'text/markdown; charset=utf-8',
    'text/html; charset=utf-8',
    'application/json',
    'text/csv; charset=utf-8'
  ]),
  bytes: Schema.Uint8Array.check(Schema.makeFilter((bytes) => bytes.length <= 8 * 1024 * 1024)),
  omissions: Schema.Array(exportOmissionSchema)
});

/** JSON transport uses decimal strings for branded bigint identities, via toCodecJson. */
export const materialAidExportSchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  version: materialVersionDetailSchema,
  citations: Schema.Array(materialCitationSchema)
});
