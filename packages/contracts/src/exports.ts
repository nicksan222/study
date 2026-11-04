import { Schema } from 'effect';

import { blockIdSchema } from './sources/schemas.ts';

export const exportFormatSchema = Schema.Literals(['markdown', 'html', 'aid_json', 'csv']);

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

export const MAX_EXPORT_BYTES = 8 * 1024 * 1024;
