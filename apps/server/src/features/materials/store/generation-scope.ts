/** @file Owns generation scope within this feature. */

import { StudyError } from '@study/contracts';
import * as s from '@study/db';
import { eq } from '@study/db';

import type { StoreResources } from '#server/platform/definitions/define-store';

import type { Scope } from './generation-schemas.ts';
import { makeWrites, now } from './writes.ts';

export function makeGenerationScope(resources: StoreResources) {
  const { db, clock } = resources;
  const { assertProject } = makeWrites(resources);

  function setGenerationScope(value: Scope, enabled: boolean) {
    assertProject(value.projectId);

    const existing = db.orm
      .select()
      .from(s.material_generation_scopes)
      .where(eq(s.material_generation_scopes.id, value.scopeId))
      .get();

    if (existing && existing.project_id !== value.projectId)
      throw new StudyError('invalid_input', 'Generation scope belongs to another project');

    if (existing) {
      if (!enabled && existing.enabled)
        db.orm
          .update(s.material_generation_scopes)
          .set({ enabled: false, updated_at: now(clock) })
          .where(eq(s.material_generation_scopes.id, value.scopeId))
          .run();

      return;
    }

    db.orm
      .insert(s.material_generation_scopes)
      .values({
        id: value.scopeId,
        project_id: value.projectId,
        enabled,
        created_at: now(clock),
        updated_at: now(clock)
      })
      .run();
  }

  function assertActiveScope(request: {
    scopeId?: string | undefined;
    projectId?: Scope['projectId'];
    kind?: string;
  }) {
    if (request.kind === 'page') return;

    if (request.projectId === undefined)
      throw new StudyError('invalid_input', 'Collection generation requires a project');

    assertProject(request.projectId);

    if (request.scopeId === undefined) return;

    const scope = db.orm
      .select()
      .from(s.material_generation_scopes)
      .where(eq(s.material_generation_scopes.id, request.scopeId))
      .get();

    if (!scope || scope.project_id !== request.projectId || !scope.enabled)
      throw new StudyError('invalid_input', 'Generation scope is not active for this project');
  }

  return { assertActiveScope, setGenerationScope };
}
