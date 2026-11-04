/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Groups write-side material store mutations and their typed definitions.            │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Collects write operations and schemas for the private material store.                  │
 * │ - Keeps persistence inputs and results typed for service-layer composition.              │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Typed store helpers own database access; the materials service applies policy and        │
 * │ composes these private operations.                                                       │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { StudyError } from '@study/contracts/errors';
import type {
  ContentSnapshotId,
  MaterialId,
  MaterialVersionId,
  ProjectId,
  SessionId
} from '@study/contracts/ids';
import type { ContentInput } from '@study/contracts/inputs';
import type { createMaterialVersionInputSchema } from '@study/contracts/materials/schemas';
import { and, eq, desc } from '@study/db';
import * as s from '@study/db/schema';

import type { StoreResources } from '#server/platform/definitions/define-store';

import { makeContent } from './content.ts';
import { makeExactInputs } from './exact-inputs.ts';
import { makeReads, required } from './reads.ts';

export { unixSeconds as now } from '#server/platform/time/index';
import { unixSeconds as now } from '#server/platform/time/index';

export function makeWrites(resources: StoreResources) {
  const { db: store, clock } = resources;
  const { insertContent } = makeContent(resources);
  const { materialRow, versionRow, readVersion } = makeReads(resources);
  const exact = makeExactInputs(resources);

  function assertProject(id: ProjectId) {
    required(store.orm.select().from(s.projects).where(eq(s.projects.id, id)).get());
  }

  function assertSession(id: SessionId) {
    required(store.orm.select().from(s.sessions).where(eq(s.sessions.id, id)).get());
  }

  function assertMembership(projectId: ProjectId, materialId: MaterialId) {
    assertProject(projectId);

    if (
      !store.orm
        .select()
        .from(s.project_materials)
        .where(
          and(
            eq(s.project_materials.project_id, projectId),
            eq(s.project_materials.material_id, materialId)
          )
        )
        .get()
    )
      throw new StudyError('invalid_input', 'Material is outside the collection scope');
  }

  function insertLinks(
    version: typeof s.material_versions.$inferSelect,
    links: { inputs?: readonly ContentInput[]; parents?: readonly MaterialVersionId[] }
  ) {
    const parents = links.parents ?? [];
    if (new Set(parents).size !== parents.length)
      throw new StudyError('invalid_input', 'Duplicate version ancestry');
    for (const id of parents) {
      const parent = versionRow(id);
      if (
        parent.id === version.id ||
        parent.status !== 'published' ||
        parent.material_id !== version.material_id
      )
        throw new StudyError(
          'invalid_input',
          'Ancestry requires a published version of the same learning artifact'
        );
      store.orm
        .insert(s.material_version_parents)
        .values({ version_id: version.id, parent_version_id: id, material_id: version.material_id })
        .run();
    }
    exact.insertInputs({ kind: 'version', id: version.id }, links.inputs ?? []);
  }

  function insertVersion(
    materialId: MaterialId,
    input: typeof createMaterialVersionInputSchema.Type
  ) {
    const material = materialRow(materialId);

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
        kind: material.kind,
        number: (last?.number ?? 0n) + 1n,
        status: 'draft',
        creator: 'user',
        operation: input.operation ?? 'original',
        language: input.language ?? null,
        created_at: now(clock)
      })
      .returning()
      .get();

    insertLinks(version, input);

    insertContent(version, input.content);

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

    if (version.status !== 'draft')
      throw new StudyError('invalid_input', 'Published versions are immutable');

    // Decode the canonical content again so a draft cannot publish a stale projection.
    readVersion(id);

    // Recheck ownership and archive state at publication even for an older draft.
    const parents = store.orm
      .select()
      .from(s.material_version_parents)
      .where(eq(s.material_version_parents.version_id, id))
      .all();

    for (const targetId of parents.map((p) => p.parent_version_id)) {
      const target = versionRow(targetId);

      materialRow(target.material_id);
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

  return { assertProject, assertSession, assertMembership, insertLinks, insertVersion, publish };
}
