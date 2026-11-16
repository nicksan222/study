/** @file Owns rows within this feature. */

import type { ContentSnapshotId, SourceId } from '@study/contracts';
import { MAX_SOURCE_BYTES, StudyError, decodeBlockContent, documentSchema } from '@study/contracts';
import * as tables from '@study/db';
import { eq, getTableColumns } from '@study/db';
import type { StoreResources } from '@study/server';
import { Schema } from 'effect';

export function makeHelpers({ db }: StoreResources) {
  function selectSources() {
    return db.orm
      .select({ ...getTableColumns(tables.sources), project_name: tables.projects.name })
      .from(tables.sources)
      .leftJoin(tables.projects, eq(tables.projects.id, tables.sources.project_id));
  }

  function sourceRow(row: ReturnType<ReturnType<typeof selectSources>['all']>[number]) {
    return {
      id: row.id,
      name: row.name,
      kind: row.kind,
      mime: row.mime,
      origin: row.origin,
      projectId: row.project_id,
      projectName: row.project_name,
      sizeBytes: row.size_bytes,
      sha256: new Uint8Array(row.sha256),
      uri: row.uri,
      createdAt: row.created_at
    };
  }

  function find(id: SourceId) {
    const row = selectSources().where(eq(tables.sources.id, id)).get();

    return row ? sourceRow(row) : null;
  }

  function state(id: SourceId) {
    const row = db.orm
      .select()
      .from(tables.source_processing)
      .where(eq(tables.source_processing.source_id, id))
      .get();

    return row
      ? {
          sourceId: id,
          revision: Number(row.revision),
          requestId: row.request_id,
          documentId: row.document_id
        }
      : null;
  }

  function checkState(id: SourceId, expectedRevision: number, requestId?: string) {
    const current = state(id);

    if (!current) throw new StudyError('not_found', 'source processing not found');

    if (
      current.revision !== expectedRevision ||
      (requestId !== undefined && current.requestId !== requestId)
    )
      throw new StudyError('invalid_input', 'source processing is stale');

    return current;
  }

  function readDocument(row: { id: ContentSnapshotId; meta: string }) {
    const blocks = db.orm
      .select({
        id: tables.blocks.editing_id,
        content: tables.blocks.content,
        kind: tables.blocks.kind,
        text: tables.blocks.text,
        anchor: tables.blocks.anchor
      })
      .from(tables.blocks)
      .where(eq(tables.blocks.document_id, row.id))
      .orderBy(tables.blocks.ordinal)
      .all()
      .map((block) => ({
        ...block,
        content: decodeBlockContent(block.content),
        anchor: JSON.parse(block.anchor)
      }));

    return {
      id: row.id,
      document: Schema.decodeUnknownSync(documentSchema)({ meta: JSON.parse(row.meta), blocks })
    };
  }

  return { selectSources, sourceRow, find, state, checkState, readDocument };
}

export function checkedBytes(value: Uint8Array) {
  if (!value.byteLength || value.byteLength > MAX_SOURCE_BYTES)
    throw new StudyError('invalid_input', 'source size is outside the allowed range');

  return Buffer.from(value);
}
