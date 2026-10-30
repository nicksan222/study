import { StudyError } from '@study/contracts/errors';
import type { SourceIndexed } from '@study/contracts/events';
import type { MaterialContentInput } from '@study/contracts/materials/schemas';
import { and, eq, isNull } from '@study/db';
import * as s from '@study/db/schema';

import type { StoreResources } from '#server/platform/definitions/define-store';

import { makeCreateMaterial } from './create-material.ts';
import { makeReads, required } from './reads.ts';

export function makeProjectSource(resources: StoreResources) {
  const { db } = resources;
  const { createMaterial, createMaterialFromDocument } = makeCreateMaterial(resources);
  const { readMaterial, readVersion } = makeReads(resources);

  function projectSource(event: SourceIndexed) {
    const source = db.orm.select().from(s.sources).where(eq(s.sources.id, event.sourceId)).get();
    const state = db.orm
      .select()
      .from(s.source_processing)
      .where(eq(s.source_processing.source_id, event.sourceId))
      .get();
    const document = db.orm
      .select()
      .from(s.documents)
      .where(eq(s.documents.id, event.documentId))
      .get();

    if (
      !source ||
      source.project_id !== event.projectId ||
      !document ||
      document.source_id !== event.sourceId ||
      !state ||
      state.document_id !== event.documentId ||
      state.revision !== BigInt(event.inputVersion) ||
      state.published_request_id !== state.request_id
    )
      throw new StudyError(
        'invalid_input',
        'Source projection is stale or belongs to another project'
      );

    let originalId: typeof s.material_versions.$inferSelect.id | undefined;

    for (const table of [
      s.material_file_versions,
      s.material_image_versions,
      s.material_audio_versions,
      s.material_video_versions,
      s.material_link_versions
    ]) {
      const row = db.orm
        .select({ id: s.material_versions.id })
        .from(table)
        .innerJoin(s.material_versions, eq(s.material_versions.id, table.version_id))
        .innerJoin(s.materials, eq(s.materials.id, s.material_versions.material_id))
        .innerJoin(
          s.material_source_snapshots,
          eq(s.material_source_snapshots.version_id, s.material_versions.id)
        )
        .where(
          and(
            eq(table.source_id, event.sourceId),
            eq(s.material_source_snapshots.revision, BigInt(event.inputVersion)),
            eq(s.material_versions.operation, 'original'),
            eq(s.material_versions.project_id, event.projectId),
            isNull(s.materials.archived_at),
            eq(s.material_versions.status, 'published')
          )
        )
        .orderBy(s.material_versions.id)
        .get();

      if (row && (originalId === undefined || row.id < originalId)) originalId = row.id;
    }

    let originalCreated = false;

    if (originalId === undefined) {
      const common = { sourceId: source.id };
      let content: MaterialContentInput;

      switch (source.kind) {
        case 'image':
          content = { kind: 'image', ...common, width: null, height: null };
          break;
        case 'audio':
          content = {
            kind: 'audio',
            ...common,
            durationMs: null,
            sampleRate: null,
            channels: null
          };
          break;
        case 'video':
          content = { kind: 'video', ...common, durationMs: null, width: null, height: null };
          break;
        case 'link':
          content = { kind: 'link', ...common };
          break;
        case 'archive':
        case 'code':
        case 'document':
        case 'note':
        case 'other':
        case 'pdf':
        case 'slides':
        case 'spreadsheet':
        case 'text':
        case 'web':
          content = { kind: 'file', ...common };
      }

      originalId = createMaterial({
        projectId: event.projectId,
        title: source.name.trim().slice(0, 200),
        content,
        operation: 'original'
      }).version.id;
      originalCreated = true;
    }

    const originalVersion = required(readVersion(originalId));
    const original = {
      ...required(readMaterial(originalVersion.material_id)),
      version: originalVersion
    };
    const operation = source.kind === 'audio' || source.kind === 'video' ? 'transcribe' : 'extract';
    const existing = db.orm
      .select({ id: s.material_versions.id })
      .from(s.material_document_versions)
      .innerJoin(
        s.material_versions,
        eq(s.material_versions.id, s.material_document_versions.version_id)
      )
      .innerJoin(s.materials, eq(s.materials.id, s.material_versions.material_id))
      .innerJoin(
        s.material_version_inputs,
        eq(s.material_version_inputs.version_id, s.material_versions.id)
      )
      .where(
        and(
          eq(s.material_version_inputs.input_version_id, originalId),
          eq(s.material_versions.project_id, event.projectId),
          isNull(s.materials.archived_at),
          eq(s.material_document_versions.document_id, event.documentId),
          eq(s.material_versions.operation, operation),
          eq(s.material_versions.status, 'published')
        )
      )
      .orderBy(s.material_versions.id)
      .get();
    let extractedCreated = false;
    let extracted;

    if (existing) {
      const version = required(readVersion(existing.id));

      extracted = { ...required(readMaterial(version.material_id)), version };
    } else {
      extracted = createMaterialFromDocument({
        projectId: event.projectId,
        title: source.name.trim().slice(0, 200),
        documentId: event.documentId,
        operation,
        inputs: [originalId]
      });
      extractedCreated = true;
    }

    return { original, extracted, originalCreated, extractedCreated };
  }

  return { projectSource };
}
