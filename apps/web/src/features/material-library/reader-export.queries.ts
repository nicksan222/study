import type { learningExportFormatSchema } from '@study/contracts/materials/export';
import type { MaterialVersionDetailDto } from '@study/contracts/materials/schemas';
import { downloadFile } from '@study/ui/download';

import { request } from '#web/lib/study-client/request.ts';

type Format = typeof learningExportFormatSchema.Type;

/** Only offers serializers supported by the selected version's retained content. */
export function availableExportFormats(version: MaterialVersionDetailDto): Format[] {
  const content = version.content;

  if (content.kind === 'flashcards' || content.kind === 'quiz') return ['aid_json', 'csv'];

  if (content.kind === 'diagram') return ['aid_json'];

  return [];
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
