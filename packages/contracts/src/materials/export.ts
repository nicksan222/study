import { Schema } from 'effect';

import { materialVersionIdSchema } from '../ids.ts';
import { blockIdSchema } from '../sources/schemas.ts';
import { materialVersionDetailSchema, materialCitationSchema } from './schemas.ts';

export const exportFormatSchema = Schema.Literals(['markdown', 'html', 'aid_json', 'csv']);
export const exportMaterialVersionInputSchema = Schema.Struct({
  id: materialVersionIdSchema,
  format: exportFormatSchema
});
export const exportOmissionSchema = Schema.Struct({
  code: Schema.Literals([
    'image_not_embedded',
    'unsafe_link',
    'math_not_rendered',
    'metadata_sidecar',
    'csv_structure',
    'source_fidelity'
  ]),
  blockId: Schema.optional(blockIdSchema)
});
export const materialVersionFileSchema = Schema.Struct({
  versionId: materialVersionIdSchema,
  format: exportFormatSchema,
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
export const MAX_EXPORT_BYTES = 8 * 1024 * 1024;

/** JSON transport uses decimal strings for branded bigint identities, via toCodecJson. */
export const materialAidExportSchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  version: materialVersionDetailSchema,
  citations: Schema.Array(materialCitationSchema)
});
