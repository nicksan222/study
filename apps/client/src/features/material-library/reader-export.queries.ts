import type { learningExportFormatSchema, MaterialVersionDetailDto } from '@study/contracts';
import { rpc } from '@study/contracts/react';
import { downloadFile } from '@study/ui';

type Format = typeof learningExportFormatSchema.Type;

/** Only offers serializers supported by the selected version's retained content. */
export function availableExportFormats(): Format[] {
  return ['aid_json', 'csv'];
}

export async function exportReaderVersion(id: MaterialVersionDetailDto['id'], format: Format) {
  const result = await rpc.materials.exportMaterialVersion.read({ id, format });

  downloadFile(
    result.filename,
    new Blob([new Uint8Array(result.bytes)], { type: result.mediaType })
  );

  return result.omissions;
}
