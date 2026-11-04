/** Mechanical normalized persistence columns for an exact readable content reference. */
import type { ContentInput } from '@study/contracts/inputs';
export function contentInputColumns(input: ContentInput) {
  return input.kind === 'document'
    ? {
        document_version_id: input.versionId,
        source_id: null,
        source_revision: null,
        source_snapshot_id: null
      }
    : {
        document_version_id: null,
        source_id: input.sourceId,
        source_revision: input.revision,
        source_snapshot_id: input.snapshotId
      };
}
