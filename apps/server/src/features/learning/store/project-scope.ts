/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Builds explicit collection membership predicates for learning queries.             │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Rejects unavailable explicitly requested collection scopes.                            │
 * │ - Shares membership filtering within the learning feature stores.                        │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Queries the canonical SQLite membership tables without changing library ownership.       │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { StudyError } from '@study/contracts/errors';
import type { ProjectId } from '@study/contracts/ids';
import { eq, inArray } from '@study/db';
import * as s from '@study/db/schema';

import type { StoreResources } from '#server/platform/definitions/define-store';

export function projectMaterialScope(db: StoreResources['db'], projectId?: ProjectId) {
  if (projectId === undefined) return undefined;

  if (!db.orm.select().from(s.projects).where(eq(s.projects.id, projectId)).get())
    throw new StudyError('not_found', 'Collection scope is unavailable');

  return inArray(
    s.material_versions.material_id,
    db.orm
      .select({ id: s.project_materials.material_id })
      .from(s.project_materials)
      .where(eq(s.project_materials.project_id, projectId))
  );
}
