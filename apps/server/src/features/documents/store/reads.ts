/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Reads independent authored Documents and exact retained version bodies.            │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Reads independent authored Documents and exact retained version bodies.                │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Private synchronous persistence stays inside Documents ownership; callers own            │
 * │ transaction scope.                                                                       │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import type * as r from '@study/contracts/documents/rpc';
import type { ExactDocumentInput, StudyDocumentVersion } from '@study/contracts/documents/types';
import { StudyError } from '@study/contracts/errors';
import type {
  StudyDocumentId,
  StudyDocumentVersionId,
  ContentSnapshotId
} from '@study/contracts/ids';
import { documentSchema } from '@study/contracts/sources/schemas';
import { and, asc, desc, eq, isNull, lt, sql } from '@study/db';
import * as s from '@study/db/schema';
import { Schema } from 'effect';

import { decodeStoredBlock } from '#server/platform/database/content-block';
import type { StoreResources } from '#server/platform/definitions/define-store';

import { required } from './errors.ts';

export function makeDocumentReads({ db }: StoreResources) {
  const orm = db.orm;

  function aggregate(id: StudyDocumentId) {
    if (
      orm
        .select()
        .from(s.study_document_deletions)
        .where(eq(s.study_document_deletions.document_id, id))
        .get()
    )
      throw new StudyError('not_found', 'Document is deleted');

    return required(orm.select().from(s.study_documents).where(eq(s.study_documents.id, id)).get());
  }

  function liveVersion(id: StudyDocumentVersionId) {
    if (
      orm
        .select()
        .from(s.study_document_retirements)
        .where(eq(s.study_document_retirements.version_id, id))
        .get()
    )
      throw new StudyError('not_found', 'Document version body is retired');

    const v = required(
      orm.select().from(s.study_document_versions).where(eq(s.study_document_versions.id, id)).get()
    );

    aggregate(v.document_id);

    return v;
  }

  function content(id: ContentSnapshotId) {
    const snapshot = required(
      orm.select().from(s.content_snapshots).where(eq(s.content_snapshots.id, id)).get()
    );
    const blocks = orm
      .select()
      .from(s.blocks)
      .where(eq(s.blocks.document_id, id))
      .orderBy(asc(s.blocks.ordinal))
      .all()
      .map(decodeStoredBlock);

    return Schema.decodeUnknownSync(documentSchema)({ blocks, meta: JSON.parse(snapshot.meta) });
  }

  function inputValue(i: typeof s.study_document_inputs.$inferSelect): ExactDocumentInput {
    if (i.document_version_id !== null)
      return { kind: 'document', versionId: i.document_version_id };

    if (i.source_id !== null)
      return {
        kind: 'source',
        sourceId: i.source_id,
        revision: required(i.source_revision),
        snapshotId: i.source_snapshot_id
      };

    if (i.exact_message_version_id !== null)
      return { kind: 'message', versionId: i.exact_message_version_id };

    throw new StudyError('invalid_input', 'Exact authored input identity is missing');
  }

  function version(id: StudyDocumentVersionId): StudyDocumentVersion {
    const v = liveVersion(id);
    const inputs = orm
      .select()
      .from(s.study_document_inputs)
      .where(eq(s.study_document_inputs.version_id, id))
      .orderBy(asc(s.study_document_inputs.position))
      .all();
    const citations = orm
      .select()
      .from(s.study_document_citations)
      .where(eq(s.study_document_citations.version_id, id))
      .orderBy(asc(s.study_document_citations.marker))
      .all()
      .map((x) => ({
        marker: Number(x.marker),
        input: inputValue(required(inputs.find((i) => i.id === x.input_id))),
        anchor: JSON.parse(x.anchor),
        target: x.target === null ? null : JSON.parse(x.target),
        quote: x.quote
      }));

    return {
      id: v.id,
      documentId: v.document_id,
      number: v.number,
      status: v.status,
      operation: v.operation,
      creator: v.creator,
      snapshotId: v.content_snapshot_id,
      instruction: v.instruction,
      language: v.language,
      createdAt: v.created_at,
      publishedAt: v.published_at,
      parents: orm
        .select()
        .from(s.study_document_version_parents)
        .where(eq(s.study_document_version_parents.version_id, id))
        .all()
        .map((p) => p.parent_version_id),
      inputs: inputs.map(inputValue),
      citations,
      document: content(v.content_snapshot_id)
    };
  }

  function head(id: StudyDocumentId) {
    return orm
      .select()
      .from(s.study_document_versions)
      .where(
        and(
          eq(s.study_document_versions.document_id, id),
          eq(s.study_document_versions.status, 'published'),
          sql`NOT EXISTS(SELECT 1 FROM study_document_retirements r WHERE r.version_id=${s.study_document_versions.id})`
        )
      )
      .orderBy(desc(s.study_document_versions.number))
      .get();
  }

  function summary(id: StudyDocumentId) {
    const a = aggregate(id);

    return {
      id: a.id,
      projectIds: orm
        .select()
        .from(s.project_documents)
        .where(eq(s.project_documents.document_id, a.id))
        .orderBy(asc(s.project_documents.project_id))
        .all()
        .map((x) => x.project_id),
      title: a.title,
      description: a.description,
      createdAt: a.created_at,
      updatedAt: a.updated_at,
      archivedAt: a.archived_at,
      headVersionId: head(id)?.id ?? null
    };
  }

  function document(id: StudyDocumentId) {
    const a = summary(id);

    return { ...a, version: a.headVersionId === null ? null : version(a.headVersionId) };
  }

  function documents(v: typeof r.listSchema.Type) {
    const rows = orm
      .select()
      .from(s.study_documents)
      .where(
        and(
          v.cursor === undefined ? undefined : lt(s.study_documents.id, v.cursor),
          v.archived
            ? sql`${s.study_documents.archived_at} IS NOT NULL`
            : isNull(s.study_documents.archived_at),
          sql`NOT EXISTS(SELECT 1 FROM study_document_deletions d WHERE d.document_id=${s.study_documents.id})`,
          v.projectId === undefined
            ? undefined
            : sql`EXISTS(SELECT 1 FROM project_documents p WHERE p.document_id=${s.study_documents.id} AND p.project_id=${v.projectId})`,
          v.sessionId === undefined
            ? undefined
            : sql`EXISTS(SELECT 1 FROM session_documents p WHERE p.document_id=${s.study_documents.id} AND p.session_id=${v.sessionId} AND p.archived_at IS NULL)`
        )
      )
      .orderBy(desc(s.study_documents.id))
      .limit(v.limit + 1)
      .all();

    return {
      items: rows.slice(0, v.limit).map((x) => summary(x.id)),
      nextCursor: rows.length > v.limit ? required(rows[v.limit - 1]).id : null
    };
  }

  function versions(v: typeof r.versionsSchema.Type) {
    aggregate(v.documentId);
    const rows = orm
      .select()
      .from(s.study_document_versions)
      .where(
        and(
          eq(s.study_document_versions.document_id, v.documentId),
          v.cursor === undefined
            ? undefined
            : sql`${s.study_document_versions.number} < (SELECT number FROM study_document_versions WHERE id=${v.cursor} AND document_id=${v.documentId})`,
          sql`NOT EXISTS(SELECT 1 FROM study_document_retirements r WHERE r.version_id=${s.study_document_versions.id})`
        )
      )
      .orderBy(desc(s.study_document_versions.number))
      .limit(v.limit + 1)
      .all();

    return {
      items: rows.slice(0, v.limit).map((x) => version(x.id)),
      nextCursor: rows.length > v.limit ? required(rows[v.limit - 1]).id : null
    };
  }

  function generationRequest(id: string) {
    return orm
      .select()
      .from(s.study_document_generation_requests)
      .where(eq(s.study_document_generation_requests.id, id))
      .get();
  }

  return {
    generationRequest,
    aggregate,
    liveVersion,
    content,
    inputValue,
    version,
    head,
    summary,
    document,
    documents,
    versions
  };
}
