/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Projects an indexed source into linked material records and extracted content.     │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Creates or updates source-derived materials from indexed source data.                  │
 * │ - Keeps persistence inputs and results typed for service-layer composition.              │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Typed store helpers own database access; the materials service applies policy and        │
 * │ composes these private operations.                                                       │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { StudyError } from '@study/contracts/errors';
import type { SourceIndexed } from '@study/contracts/events';
import type { SourceId } from '@study/contracts/ids';
import type { MaterialContentInput, MaterialKind } from '@study/contracts/materials/schemas';
import { and, eq, asc } from '@study/db';
import * as s from '@study/db/schema';

import type { StoreResources } from '#server/platform/definitions/define-store';

import { makeCreateMaterial } from './create-material.ts';
import { makeReads, required } from './reads.ts';
import { makeWrites } from './writes.ts';

export function makeProjectSource(resources: StoreResources) {
  const { db } = resources;
  const { createMaterial } = makeCreateMaterial(resources);
  const { readMaterial, readVersion } = makeReads(resources);
  const { insertVersion } = makeWrites(resources);

  function originalContent(
    source: typeof s.sources.$inferSelect,
    kind: MaterialKind | typeof source.kind = source.kind
  ): MaterialContentInput {
    const common = { sourceId: source.id };

    switch (kind) {
      case 'image':
        return { kind: 'image', ...common, width: null, height: null };
      case 'audio':
        return { kind: 'audio', ...common, durationMs: null, sampleRate: null, channels: null };
      case 'video':
        return { kind: 'video', ...common, durationMs: null, width: null, height: null };
      case 'link':
        return { kind: 'link', ...common };
      default:
        return { kind: 'file', ...common };
    }
  }

  function sourceState(sourceId: SourceId) {
    const source = required(
      db.orm.select().from(s.sources).where(eq(s.sources.id, sourceId)).get()
    );
    const state = required(
      db.orm
        .select()
        .from(s.source_processing)
        .where(eq(s.source_processing.source_id, sourceId))
        .get()
    );

    return { source, state };
  }

  function registerSource(sourceId: SourceId) {
    const { source, state } = sourceState(sourceId);
    const binding = db.orm
      .select()
      .from(s.material_imports)
      .where(eq(s.material_imports.source_id, sourceId))
      .get();

    if (!binding) {
      const original = createMaterial(
        {
          ...(source.project_id === null ? {} : { projectId: source.project_id }),
          title: source.name.trim().slice(0, 200),
          content: originalContent(source),
          operation: 'original'
        },
        'import'
      );

      db.orm
        .insert(s.material_imports)
        .values({ source_id: sourceId, material_id: original.id })
        .run();

      return { original, originalCreated: true };
    }

    const material = required(readMaterial(binding.material_id));
    const existing = db.orm
      .select({ id: s.material_versions.id })
      .from(s.material_versions)
      .innerJoin(
        s.material_source_snapshots,
        eq(s.material_source_snapshots.version_id, s.material_versions.id)
      )
      .where(
        and(
          eq(s.material_versions.material_id, binding.material_id),
          eq(s.material_versions.operation, 'original'),
          eq(s.material_source_snapshots.revision, state.revision)
        )
      )
      .orderBy(asc(s.material_versions.number))
      .get();
    const id =
      existing?.id ??
      insertVersion(
        material.id,
        {
          content: originalContent(source, material.kind),
          operation: 'original'
        },
        { documentId: null }
      );

    return {
      original: { ...material, version: required(readVersion(id)) },
      originalCreated: !existing
    };
  }

  function projectionSource(event: SourceIndexed) {
    const { source, state } = sourceState(event.sourceId);
    const document = db.orm
      .select()
      .from(s.documents)
      .where(eq(s.documents.id, event.documentId))
      .get();

    if (
      !document ||
      document.source_id !== source.id ||
      state.document_id !== event.documentId ||
      state.revision !== BigInt(event.inputVersion) ||
      state.published_request_id !== state.request_id
    )
      throw new StudyError('invalid_input', 'Source projection is stale');

    return source;
  }

  function projectSource(event: SourceIndexed) {
    const source = projectionSource(event);
    const { original, originalCreated } = registerSource(source.id);

    const existing = db.orm
      .select({ id: s.material_source_snapshots.version_id })
      .from(s.material_source_snapshots)
      .where(eq(s.material_source_snapshots.document_id, event.documentId))
      .get();
    const id =
      existing?.id ??
      insertVersion(
        original.id,
        {
          content: originalContent(source, original.kind),
          operation: source.kind === 'audio' || source.kind === 'video' ? 'transcribe' : 'extract',
          inputs: [original.version.id]
        },
        { documentId: event.documentId }
      );
    const extracted = {
      ...required(readMaterial(original.id)),
      version: required(readVersion(id))
    };

    return {
      original: { ...extracted, version: original.version },
      extracted,
      originalCreated,
      extractedCreated: !existing
    };
  }

  function assignSourceProject(sourceId: SourceId) {
    const { source } = sourceState(sourceId);
    const binding = db.orm
      .select()
      .from(s.material_imports)
      .where(eq(s.material_imports.source_id, sourceId))
      .get();

    if (binding && source.project_id !== null)
      db.orm
        .insert(s.project_materials)
        .values({ material_id: binding.material_id, project_id: source.project_id })
        .onConflictDoNothing()
        .run();
  }

  return { registerSource, projectSource, assignSourceProject };
}
