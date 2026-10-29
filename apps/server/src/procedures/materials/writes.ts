import * as s from '@study/db/schema';
import { eq, desc } from 'drizzle-orm';

import type { ServerContext } from '#server/runtime/context';
import { StudyError } from '#server/shared/errors/index';
import type { createMaterialVersionInputSchema } from '#server/shared/materials/schemas';

import { insertContent } from './content.ts';
import { materialRow, required, versionRow } from './reads.ts';

export const now = () => BigInt(Math.floor(Date.now() / 1000));

export function assertProject(store: ServerContext, id: bigint) {
  required(store.db.orm.select().from(s.projects).where(eq(s.projects.id, id)).get());
}

export function assertSession(store: ServerContext, id: bigint, projectId: bigint) {
  const session = required(
    store.db.orm.select().from(s.sessions).where(eq(s.sessions.id, id)).get()
  );

  if (session.project_id !== projectId)
    throw new StudyError('invalid_input', 'Session belongs to another project');
}

export function insertLinks(
  store: ServerContext,
  version: typeof s.material_versions.$inferSelect,
  links: { inputs?: readonly bigint[]; parents?: readonly bigint[] }
) {
  for (const [ids, parent] of [
    [links.inputs ?? [], false],
    [links.parents ?? [], true]
  ] as const) {
    if (new Set(ids).size !== ids.length)
      throw new StudyError('invalid_input', 'Duplicate version links');

    for (const id of ids) {
      const target = versionRow(store, id);

      materialRow(store, target.material_id, true);

      if (
        id === version.id ||
        target.status !== 'published' ||
        target.project_id !== version.project_id ||
        (parent && target.material_id !== version.material_id)
      )
        throw new StudyError('invalid_input', 'Invalid material version link');

      if (parent)
        store.db.orm
          .insert(s.material_version_parents)
          .values({
            version_id: version.id,
            parent_version_id: id,
            material_id: version.material_id
          })
          .run();
      else
        store.db.orm
          .insert(s.material_version_inputs)
          .values({ version_id: version.id, input_version_id: id, project_id: version.project_id })
          .run();
    }
  }
}

export function insertVersion(
  store: ServerContext,
  materialId: bigint,
  input: typeof createMaterialVersionInputSchema.Type,
  documentId?: bigint
) {
  const material = materialRow(store, materialId, true);

  if (material.kind !== input.content.kind)
    throw new StudyError('invalid_input', 'Version kind must match material');

  const last = store.db.orm
    .select()
    .from(s.material_versions)
    .where(eq(s.material_versions.material_id, materialId))
    .orderBy(desc(s.material_versions.number))
    .get();
  const version = store.db.orm
    .insert(s.material_versions)
    .values({
      material_id: materialId,
      project_id: material.project_id,
      kind: material.kind,
      number: (last?.number ?? 0n) + 1n,
      status: 'draft',
      operation: input.operation ?? 'original',
      language: input.language ?? null,
      created_at: now()
    })
    .returning()
    .get();

  if (documentId !== undefined)
    store.db.orm
      .insert(s.material_document_versions)
      .values({ version_id: version.id, document_id: documentId })
      .run();
  else insertContent(store, version, input.content);

  insertLinks(store, version, input);

  if (input.publish !== false) publish(store, version.id);

  store.db.orm
    .update(s.materials)
    .set({ updated_at: now() })
    .where(eq(s.materials.id, materialId))
    .run();

  return version.id;
}

export function publish(store: ServerContext, id: bigint) {
  const version = versionRow(store, id, true);
  // Recheck ownership and archive state at publication even for an older draft.
  const inputs = store.db.orm
    .select()
    .from(s.material_version_inputs)
    .where(eq(s.material_version_inputs.version_id, id))
    .all();
  const parents = store.db.orm
    .select()
    .from(s.material_version_parents)
    .where(eq(s.material_version_parents.version_id, id))
    .all();

  for (const targetId of [
    ...inputs.map((i) => i.input_version_id),
    ...parents.map((p) => p.parent_version_id)
  ]) {
    const target = versionRow(store, targetId);

    materialRow(store, target.material_id, true);
  }

  store.db.orm
    .update(s.material_versions)
    .set({ status: 'published', published_at: now() })
    .where(eq(s.material_versions.id, id))
    .run();
  store.db.orm
    .update(s.materials)
    .set({ updated_at: now() })
    .where(eq(s.materials.id, version.material_id))
    .run();
}
