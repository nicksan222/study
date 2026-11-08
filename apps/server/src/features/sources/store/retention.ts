/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Finds exact evidence and image roots retaining independent source bytes.           │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Finds exact evidence and image roots retaining independent source bytes.               │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Private synchronous persistence stays inside its feature; callers own transaction scope. │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import type { SourceId } from '@study/contracts/ids';
import { sql } from '@study/db';

import type { StoreResources } from '#server/platform/definitions/define-store';

export function sourceDeletionBlockers({ db }: Pick<StoreResources, 'db'>, sourceId: SourceId) {
  const blockedBy: ('exact_inputs' | 'image_assets')[] = [];

  if (
    db.orm.get(sql`SELECT 1 FROM (
    SELECT body.source_id FROM citations c JOIN content_snapshots body ON body.id=c.document_id WHERE body.source_id IS NOT NULL
    UNION ALL SELECT source_id FROM note_context_sources
    UNION ALL SELECT source_id FROM note_reply_sources
    UNION ALL SELECT source_id FROM page_inputs WHERE source_id IS NOT NULL
    UNION ALL SELECT source_id FROM material_evidence_inputs WHERE source_id IS NOT NULL
    UNION ALL SELECT source_id FROM learning_practice_inputs WHERE source_id IS NOT NULL
  ) WHERE source_id=${sourceId} LIMIT 1`)
  )
    blockedBy.push('exact_inputs');

  if (
    db.orm
      .get(sql`SELECT 1 FROM document_assets a JOIN content_snapshots body ON body.id=a.document_id
    WHERE a.source_id=${sourceId} AND body.source_id IS NOT ${sourceId} LIMIT 1`)
  )
    blockedBy.push('image_assets');

  return blockedBy;
}
