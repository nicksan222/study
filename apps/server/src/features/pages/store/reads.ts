/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Reads independent authored Pages and exact retained version bodies.                │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Reads independent authored Pages and exact retained version bodies.                    │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Private synchronous persistence stays inside Pages ownership; callers own                │
 * │ transaction scope.                                                                       │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { StudyError } from '@study/contracts/errors';
import type { PageId, PageVersionId, ContentSnapshotId } from '@study/contracts/ids';
import type * as r from '@study/contracts/pages/rpc';
import type { ExactPageInput, PageVersion } from '@study/contracts/pages/types';
import { documentSchema } from '@study/contracts/sources/schemas';
import { and, asc, desc, eq, isNull, lt, sql } from '@study/db';
import * as s from '@study/db/schema';
import { Schema } from 'effect';

import { decodeStoredBlock } from '#server/platform/database/content-block';
import type { StoreResources } from '#server/platform/definitions/define-store';

import { required } from './errors.ts';

export function makePageReads({ db }: StoreResources) {
  const orm = db.orm;

  function aggregate(id: PageId) {
    if (orm.select().from(s.page_deletions).where(eq(s.page_deletions.page_id, id)).get())
      throw new StudyError('not_found', 'Page is deleted');

    return required(orm.select().from(s.pages).where(eq(s.pages.id, id)).get());
  }

  function liveVersion(id: PageVersionId) {
    if (orm.select().from(s.page_retirements).where(eq(s.page_retirements.version_id, id)).get())
      throw new StudyError('not_found', 'Page version body is retired');

    const v = required(orm.select().from(s.page_versions).where(eq(s.page_versions.id, id)).get());

    aggregate(v.page_id);

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

  function inputValue(i: typeof s.page_inputs.$inferSelect): ExactPageInput {
    if (i.page_version_id !== null) return { kind: 'page', versionId: i.page_version_id };

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

  function version(id: PageVersionId): PageVersion {
    const v = liveVersion(id);
    const inputs = orm
      .select()
      .from(s.page_inputs)
      .where(eq(s.page_inputs.version_id, id))
      .orderBy(asc(s.page_inputs.position))
      .all();
    const citations = orm
      .select()
      .from(s.page_citations)
      .where(eq(s.page_citations.version_id, id))
      .orderBy(asc(s.page_citations.marker))
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
      pageId: v.page_id,
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
        .from(s.page_version_parents)
        .where(eq(s.page_version_parents.version_id, id))
        .all()
        .map((p) => p.parent_version_id),
      inputs: inputs.map(inputValue),
      citations,
      document: content(v.content_snapshot_id)
    };
  }

  function head(id: PageId) {
    return orm
      .select()
      .from(s.page_versions)
      .where(
        and(
          eq(s.page_versions.page_id, id),
          eq(s.page_versions.status, 'published'),
          sql`NOT EXISTS(SELECT 1 FROM page_retirements r WHERE r.version_id=${s.page_versions.id})`
        )
      )
      .orderBy(desc(s.page_versions.number))
      .get();
  }

  function summary(id: PageId) {
    const a = aggregate(id);

    return {
      id: a.id,
      projectIds: orm
        .select()
        .from(s.project_pages)
        .where(eq(s.project_pages.page_id, a.id))
        .orderBy(asc(s.project_pages.project_id))
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

  function page(id: PageId) {
    const a = summary(id);

    return { ...a, version: a.headVersionId === null ? null : version(a.headVersionId) };
  }

  function pages(v: typeof r.listSchema.Type) {
    const rows = orm
      .select()
      .from(s.pages)
      .where(
        and(
          v.cursor === undefined ? undefined : lt(s.pages.id, v.cursor),
          v.archived ? sql`${s.pages.archived_at} IS NOT NULL` : isNull(s.pages.archived_at),
          sql`NOT EXISTS(SELECT 1 FROM page_deletions d WHERE d.page_id=${s.pages.id})`,
          v.projectId === undefined
            ? undefined
            : sql`EXISTS(SELECT 1 FROM project_pages p WHERE p.page_id=${s.pages.id} AND p.project_id=${v.projectId})`,
          v.noteId === undefined
            ? undefined
            : sql`EXISTS(SELECT 1 FROM note_pages p WHERE p.page_id=${s.pages.id} AND p.note_id=${v.noteId} AND p.archived_at IS NULL)`
        )
      )
      .orderBy(desc(s.pages.id))
      .limit(v.limit + 1)
      .all();

    return {
      items: rows.slice(0, v.limit).map((x) => summary(x.id)),
      nextCursor: rows.length > v.limit ? required(rows[v.limit - 1]).id : null
    };
  }

  function versions(v: typeof r.versionsSchema.Type) {
    aggregate(v.pageId);
    const rows = orm
      .select()
      .from(s.page_versions)
      .where(
        and(
          eq(s.page_versions.page_id, v.pageId),
          v.cursor === undefined
            ? undefined
            : sql`${s.page_versions.number} < (SELECT number FROM page_versions WHERE id=${v.cursor} AND page_id=${v.pageId})`,
          sql`NOT EXISTS(SELECT 1 FROM page_retirements r WHERE r.version_id=${s.page_versions.id})`
        )
      )
      .orderBy(desc(s.page_versions.number))
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
      .from(s.page_generation_requests)
      .where(eq(s.page_generation_requests.id, id))
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
    page,
    pages,
    versions
  };
}
