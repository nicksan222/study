import { StudyError } from '@study/contracts/errors';
import type {
  DocumentId,
  MaterialId,
  MaterialVersionId,
  ProjectId,
  SessionId
} from '@study/contracts/ids';
import type { createMaterialVersionInputSchema } from '@study/contracts/materials/schemas';
import { eq, desc } from '@study/db';
import * as s from '@study/db/schema';

import type { StoreResources } from '#server/platform/definitions/define-store';

import { makeContent } from './content.ts';
import { makeReads, required } from './reads.ts';

export { unixSeconds as now } from '#server/platform/time/index';
import { unixSeconds as now } from '#server/platform/time/index';

export function makeWrites(resources: StoreResources) {
  const { db: store, clock } = resources;
  const { insertContent } = makeContent(resources);
  const { materialRow, versionRow } = makeReads(resources);

  function assertProject(id: ProjectId) {
    required(store.orm.select().from(s.projects).where(eq(s.projects.id, id)).get());
  }

  function assertSession(id: SessionId, projectId: ProjectId) {
    const session = required(
      store.orm.select().from(s.sessions).where(eq(s.sessions.id, id)).get()
    );

    if (session.project_id !== projectId)
      throw new StudyError('invalid_input', 'Session belongs to another project');
  }

  function assertLinkTarget(
    version: typeof s.material_versions.$inferSelect,
    id: MaterialVersionId,
    parent: boolean
  ) {
    const target = versionRow(id);

    materialRow(target.material_id, true);

    if (
      id === version.id ||
      target.status !== 'published' ||
      target.project_id !== version.project_id ||
      (parent && target.material_id !== version.material_id)
    )
      throw new StudyError('invalid_input', 'Invalid material version link');
  }

  function insertLinks(
    version: typeof s.material_versions.$inferSelect,
    links: { inputs?: readonly MaterialVersionId[]; parents?: readonly MaterialVersionId[] }
  ) {
    for (const [ids, parent] of [
      [links.inputs ?? [], false],
      [links.parents ?? [], true]
    ] as const) {
      if (new Set(ids).size !== ids.length)
        throw new StudyError('invalid_input', 'Duplicate version links');

      for (const id of ids) {
        assertLinkTarget(version, id, parent);

        if (parent)
          store.orm
            .insert(s.material_version_parents)
            .values({
              version_id: version.id,
              parent_version_id: id,
              material_id: version.material_id
            })
            .run();
        else
          store.orm
            .insert(s.material_version_inputs)
            .values({
              version_id: version.id,
              input_version_id: id,
              project_id: version.project_id
            })
            .run();
      }
    }
  }

  function insertVersion(
    materialId: MaterialId,
    input: typeof createMaterialVersionInputSchema.Type,
    documentId?: DocumentId
  ) {
    const material = materialRow(materialId, true);

    if (material.kind !== input.content.kind)
      throw new StudyError('invalid_input', 'Version kind must match material');

    const last = store.orm
      .select()
      .from(s.material_versions)
      .where(eq(s.material_versions.material_id, materialId))
      .orderBy(desc(s.material_versions.number))
      .get();
    const version = store.orm
      .insert(s.material_versions)
      .values({
        material_id: materialId,
        project_id: material.project_id,
        kind: material.kind,
        number: (last?.number ?? 0n) + 1n,
        status: 'draft',
        operation: input.operation ?? 'original',
        language: input.language ?? null,
        created_at: now(clock)
      })
      .returning()
      .get();

    if (documentId !== undefined)
      store.orm
        .insert(s.material_document_versions)
        .values({ version_id: version.id, document_id: documentId })
        .run();
    else insertContent(version, input.content);

    insertLinks(version, input);

    if (input.publish !== false) publish(version.id);

    store.orm
      .update(s.materials)
      .set({ updated_at: now(clock) })
      .where(eq(s.materials.id, materialId))
      .run();

    return version.id;
  }

  function publish(id: MaterialVersionId) {
    const version = versionRow(id, true);
    // Recheck ownership and archive state at publication even for an older draft.
    const inputs = store.orm
      .select()
      .from(s.material_version_inputs)
      .where(eq(s.material_version_inputs.version_id, id))
      .all();
    const parents = store.orm
      .select()
      .from(s.material_version_parents)
      .where(eq(s.material_version_parents.version_id, id))
      .all();

    for (const targetId of [
      ...inputs.map((i) => i.input_version_id),
      ...parents.map((p) => p.parent_version_id)
    ]) {
      const target = versionRow(targetId);

      materialRow(target.material_id, true);
    }

    store.orm
      .update(s.material_versions)
      .set({ status: 'published', published_at: now(clock) })
      .where(eq(s.material_versions.id, id))
      .run();
    store.orm
      .update(s.materials)
      .set({ updated_at: now(clock) })
      .where(eq(s.materials.id, version.material_id))
      .run();
  }

  return { assertProject, assertSession, insertLinks, insertVersion, publish };
}
