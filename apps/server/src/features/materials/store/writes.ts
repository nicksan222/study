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
  DocumentId,
  MaterialId,
  MaterialVersionId,
  ProjectId,
  SessionId
} from '@study/contracts/ids';
import type { createMaterialVersionInputSchema } from '@study/contracts/materials/schemas';
import { and, eq, desc } from '@study/db';
import * as s from '@study/db/schema';

import type { StoreResources } from '#server/platform/definitions/define-store';

import { makeContent } from './content.ts';
import { makeReads, required } from './reads.ts';

export { unixSeconds as now } from '#server/platform/time/index';
import { unixSeconds as now } from '#server/platform/time/index';

export function makeWrites(resources: StoreResources) {
  const { db: store, clock } = resources;
  const { insertContent, assertDocumentImages } = makeContent(resources);
  const { materialRow, versionRow, readVersion } = makeReads(resources);

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

  function assertLinkTarget(
    version: typeof s.material_versions.$inferSelect,
    id: MaterialVersionId,
    parent: boolean,
    imported = false
  ) {
    const target = versionRow(id);

    materialRow(target.material_id, !imported);

    if (
      id === version.id ||
      target.status !== 'published' ||
      (parent && target.material_id !== version.material_id)
    )
      throw new StudyError('invalid_input', 'Invalid material version link');
  }

  // A manual revision retains a published parent's identities without reopening retired evidence.
  function assertInheritedInput(
    version: typeof s.material_versions.$inferSelect,
    sourceId: MaterialVersionId,
    inputId: MaterialVersionId
  ) {
    const source = versionRow(sourceId);

    materialRow(source.material_id, true);

    if (
      version.kind !== 'document' ||
      version.creator !== 'user' ||
      version.operation !== 'edit' ||
      version.generation_request_id !== null ||
      source.status !== 'published' ||
      source.material_id !== version.material_id ||
      !store.orm
        .select()
        .from(s.material_version_parents)
        .where(
          and(
            eq(s.material_version_parents.version_id, version.id),
            eq(s.material_version_parents.parent_version_id, sourceId)
          )
        )
        .get() ||
      !store.orm
        .select()
        .from(s.material_version_inputs)
        .where(
          and(
            eq(s.material_version_inputs.version_id, sourceId),
            eq(s.material_version_inputs.input_version_id, inputId)
          )
        )
        .get()
    )
      throw new StudyError(
        'invalid_input',
        'Revision provenance must match retained published history'
      );
  }

  function writeLink(
    version: typeof s.material_versions.$inferSelect,
    id: MaterialVersionId,
    parent: boolean
  ) {
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
          input_version_id: id
        })
        .run();
  }

  function insertLinks(
    version: typeof s.material_versions.$inferSelect,
    links: { inputs?: readonly MaterialVersionId[]; parents?: readonly MaterialVersionId[] },
    imported = false,
    inheritedFrom?: MaterialVersionId
  ) {
    for (const [ids, parent] of [
      [links.parents ?? [], true],
      [links.inputs ?? [], false]
    ] as const) {
      if (new Set(ids).size !== ids.length)
        throw new StudyError('invalid_input', 'Duplicate version links');

      for (const id of ids) {
        if (parent || inheritedFrom === undefined) assertLinkTarget(version, id, parent, imported);
        else assertInheritedInput(version, inheritedFrom, id);

        writeLink(version, id, parent);
      }
    }
  }

  function insertVersion(
    materialId: MaterialId,
    input: typeof createMaterialVersionInputSchema.Type,
    imported?: { documentId: DocumentId | null },
    inheritedFrom?: MaterialVersionId
  ) {
    const material = materialRow(materialId, imported === undefined);

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
        creator: imported === undefined ? 'user' : 'import',
        operation: input.operation ?? 'original',
        language: input.language ?? null,
        created_at: now(clock)
      })
      .returning()
      .get();

    insertLinks(version, input, imported !== undefined, inheritedFrom);

    insertContent(version, input.content, imported?.documentId);

    if (input.publish !== false) publish(version.id, imported !== undefined);

    store.orm
      .update(s.materials)
      .set({ updated_at: now(clock) })
      .where(eq(s.materials.id, materialId))
      .run();

    return version.id;
  }

  function publish(id: MaterialVersionId, imported = false, inheritedFrom?: MaterialVersionId) {
    const version = versionRow(id, !imported);

    if (version.status !== 'draft')
      throw new StudyError('invalid_input', 'Published versions are immutable');

    // Decode the canonical content again so a draft cannot publish a stale projection.
    readVersion(id);
    assertDocumentImages(version);

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

    for (const input of inputs) {
      if (inheritedFrom === undefined)
        assertLinkTarget(version, input.input_version_id, false, imported);
      else assertInheritedInput(version, inheritedFrom, input.input_version_id);
    }

    for (const targetId of parents.map((p) => p.parent_version_id)) {
      const target = versionRow(targetId);

      materialRow(target.material_id, !imported);
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
