import { uploadedSourceOrigins } from '@study/contracts';
import type { SourceId, SourceOrigin } from '@study/contracts';

/** Opens a current source in the workspace for its origin. */
export function sourceLocation(id: SourceId, origin: SourceOrigin, project?: string) {
  return {
    to: '/sources/$sourceId',
    params: { sourceId: String(id) },
    search: uploadedSourceOrigins.includes(origin) ? { project, fromUploads: '1' } : { project }
  } as const;
}
