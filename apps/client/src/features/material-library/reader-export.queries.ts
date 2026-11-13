import type { learningExportFormatSchema } from '@study/contracts/materials/export';
import type { MaterialVersionDetailDto } from '@study/contracts/materials/schemas';
import { downloadFile } from '@study/ui/download';

import { request } from '#client/lib/study-client/request.ts';

type Format = typeof learningExportFormatSchema.Type;

/** Only offers serializers supported by the selected version's retained content. */
export function availableExportFormats(): Format[] {
  return ['aid_json', 'csv'];
}

export async function exportReaderVersion(id: MaterialVersionDetailDto['id'], format: Format) {
  const result = await request((client) =>
    client['materials.exportMaterialVersion']({ id, format })
  );

  downloadFile(
    result.filename,
    new Blob([new Uint8Array(result.bytes)], { type: result.mediaType })
  );

  return result.omissions;
}
