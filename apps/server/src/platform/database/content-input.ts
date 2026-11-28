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

import type { ContentInput } from '@study/contracts';

export function contentInputColumns(input: ContentInput) {
  return {
    page_version_id: input.kind === 'page' ? input.versionId : null,
    note_context_id: input.kind === 'note' ? input.contextId : null,
    source_id: input.kind === 'source' ? input.sourceId : null,
    source_revision: input.kind === 'source' ? input.revision : null,
    source_snapshot_id: input.kind === 'source' ? input.snapshotId : null
  };
}
