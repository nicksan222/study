/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Maps exact readable content references into normalized persistence columns.        │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Maps exact readable content references into normalized persistence columns.            │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Exports mechanical types and operations; owning features retain lifecycle and            │
 * │ publication policy.                                                                      │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import type { ContentInput } from '@study/contracts/inputs';

export function contentInputColumns(input: ContentInput) {
  return input.kind === 'page'
    ? {
        page_version_id: input.versionId,
        source_id: null,
        source_revision: null,
        source_snapshot_id: null
      }
    : {
        page_version_id: null,
        source_id: input.sourceId,
        source_revision: input.revision,
        source_snapshot_id: input.snapshotId
      };
}
