import { and, eq } from '@study/db';
import * as s from '@study/db/schema';

import { createMaterial } from '#server/procedures/materials/operations/create-material';
import { attachMaterial } from '#server/procedures/materials/operations/session-membership';
import { readVersion } from '#server/procedures/materials/reads';
import { readMaterial } from '#server/procedures/materials/reads';
import type { ServerContext } from '#server/runtime/context';
import type { SessionId } from '#server/shared/ids';
import type { MaterialContentInput } from '#server/shared/materials/schemas';
import type { Source } from '#server/shared/sources/types';

export interface SourceMaterialOptions {
  sessionId?: SessionId;
  title?: string;
  durationMs?: bigint | null;
  sampleRate?: bigint | null;
  channels?: bigint | null;
  width?: bigint | null;
  height?: bigint | null;
  inputs?: bigint[];
}

export function sourceMaterial(
  store: ServerContext,
  source: Source,
  options: SourceMaterialOptions = {}
) {
  if (source.projectId === null) return null;

  return store.transaction(() => {
    const existing = originalVersion(store, source.id);

    if (existing) {
      if (options.sessionId !== undefined)
        attachMaterial(store, options.sessionId, existing.material_id);

      return {
        ...readMaterial(store, existing.material_id)!,
        version: readVersion(store, existing.id)!
      };
    }

    const common = { sourceId: source.id };
    let content: MaterialContentInput;

    switch (source.kind) {
      case 'audio':
        content = {
          kind: 'audio',
          ...common,
          durationMs: options.durationMs ?? null,
          sampleRate: options.sampleRate ?? null,
          channels: options.channels ?? null
        };
        break;
      case 'video':
        content = {
          kind: 'video',
          ...common,
          durationMs: options.durationMs ?? null,
          width: options.width ?? null,
          height: options.height ?? null
        };
        break;
      case 'image':
        content = {
          kind: 'image',
          ...common,
          width: options.width ?? null,
          height: options.height ?? null
        };
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

    return createMaterial(store, {
      projectId: source.projectId!,
      sessionId: options.sessionId,
      title: (options.title ?? source.name).trim().slice(0, 200),
      content,
      inputs: options.inputs,
      operation: options.inputs?.length ? 'extract' : 'original'
    });
  });
}

/** Locate the actual typed payload rather than inferring identity from source names. */
export function originalVersion(store: ServerContext, sourceId: bigint) {
  let first: { id: bigint; material_id: bigint; project_id: bigint } | null = null;

  for (const table of [
    s.material_file_versions,
    s.material_audio_versions,
    s.material_video_versions,
    s.material_image_versions,
    s.material_link_versions
  ]) {
    const row = store.db.orm
      .select({
        id: s.material_versions.id,
        material_id: s.material_versions.material_id,
        project_id: s.material_versions.project_id
      })
      .from(table)
      .innerJoin(s.material_versions, eq(s.material_versions.id, table.version_id))
      .where(and(eq(table.source_id, sourceId), eq(s.material_versions.status, 'published')))
      .orderBy(s.material_versions.id)
      .get();

    if (row && (!first || row.id < first.id)) first = row;
  }

  return first;
}
