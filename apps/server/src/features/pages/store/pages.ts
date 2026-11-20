/** @file Builds pages pages queries and mutations with bound store resources. */

import * as c from '@study/contracts';
import * as e from '@study/contracts';
import * as r from '@study/contracts';
import { StudyError } from '@study/contracts';
import { and, eq, gt, note_pages, page_attachments, sources, sql } from '@study/db';
import { storeMutation, storeQuery } from '@study/server';
import type { StoreResources } from '@study/server';
import { Schema } from 'effect';

import { makePageDomain } from './domain.ts';

export function makePagesStore(resources: StoreResources) {
  const d = makePageDomain(resources);
  const { db } = resources;

  return {
    queries: {
      attachments: storeQuery({
        role: 'collection',
        input: r.pageAttachmentsSchema,
        output: r.pageAttachmentListSchema,
        run: ({ pageId, projectId, limit, cursor }) => {
          if (!d.page(pageId).projectIds.includes(projectId))
            throw new StudyError('not_found', 'Document is unavailable in this subject');

          const rows = db.orm
            .select({ id: sources.id, name: sources.name })
            .from(page_attachments)
            .innerJoin(sources, eq(sources.id, page_attachments.source_id))
            .where(
              and(
                eq(page_attachments.page_id, pageId),
                eq(sources.project_id, projectId),
                cursor === undefined ? undefined : gt(sources.id, cursor)
              )
            )
            .orderBy(sources.id)
            .limit(limit + 1)
            .all();

          return {
            items: rows.slice(0, limit),
            nextCursor: rows.length > limit ? rows[limit - 1]!.id : null
          };
        }
      }),
      count: storeQuery({
        role: 'required',
        input: r.pageCountInputSchema,
        output: Schema.BigInt,
        run: d.count
      }),
      page: storeQuery({
        role: 'required',
        input: r.pageKeySchema,
        output: c.detailSchema,
        run: ({ id, noteId }) => {
          if (
            noteId !== undefined &&
            !db.orm
              .select({ id: note_pages.page_id })
              .from(note_pages)
              .where(
                and(
                  eq(note_pages.page_id, id),
                  eq(note_pages.note_id, noteId),
                  sql`${note_pages.archived_at} IS NULL`
                )
              )
              .get()
          )
            throw new StudyError('not_found', 'Page is not in this note');

          return d.page(id);
        }
      }),
      pages: storeQuery({
        role: 'collection',
        input: r.listSchema,
        output: c.pageListSchema,
        run: d.pages
      })
    },
    mutations: {
      setAttachment: storeMutation({
        changes: ['pages'],
        input: r.setPageAttachmentSchema,
        output: Schema.Void,
        run: ({ pageId, projectId, sourceId, attached }) => {
          const page = d.page(pageId);

          if (
            page.archivedAt !== null ||
            !page.projectIds.includes(projectId) ||
            !db.orm
              .select({ id: sources.id })
              .from(sources)
              .where(and(eq(sources.id, sourceId), eq(sources.project_id, projectId)))
              .get()
          )
            throw new StudyError(
              'not_found',
              'Document or original is unavailable in this subject'
            );

          if (attached)
            db.orm
              .insert(page_attachments)
              .values({ page_id: pageId, source_id: sourceId })
              .onConflictDoNothing()
              .run();
          else
            db.orm
              .delete(page_attachments)
              .where(
                and(eq(page_attachments.page_id, pageId), eq(page_attachments.source_id, sourceId))
              )
              .run();
        }
      }),
      archiveNote: storeMutation({
        changes: ['pages'],
        input: Schema.Struct({
          ...r.linkSchema.fields,
          archivedAt: Schema.NullOr(Schema.BigInt)
        }),
        output: Schema.Void,
        run: (v) => {
          const changed = db.orm
            .update(note_pages)
            .set({ archived_at: v.archivedAt })
            .where(
              and(
                eq(note_pages.page_id, v.pageId),
                eq(note_pages.note_id, v.noteId),
                sql`NOT EXISTS(SELECT 1 FROM page_deletions d WHERE d.page_id=${note_pages.page_id})`
              )
            )
            .returning({ id: note_pages.page_id })
            .get();

          if (!changed) throw new StudyError('not_found', 'Note item is unavailable');
        }
      }),
      updateMetadata: storeMutation({
        changes: ['pages'],
        input: r.metadataSchema,
        output: c.detailSchema,
        run: d.updateMetadata
      }),
      create: storeMutation({
        changes: ['pages'],
        input: e.createSchema,
        output: Schema.Struct({ page: c.detailSchema, replayed: Schema.Boolean }),
        run: d.createResult
      }),
      save: storeMutation({
        changes: ['pages'],
        input: e.saveSchema,
        output: e.editOutcomeSchema,
        run: d.save
      }),
      restore: storeMutation({
        changes: ['pages'],
        input: e.restoreSchema,
        output: e.editOutcomeSchema,
        run: d.restore
      }),
      copySource: storeMutation({
        changes: ['pages'],
        input: r.sourceCopySchema,
        output: Schema.Struct({ page: c.detailSchema, replayed: Schema.Boolean }),
        run: d.copySource
      }),
      archive: storeMutation({
        changes: ['pages'],
        input: r.archiveSchema,
        output: c.detailSchema,
        run: d.archive
      }),
      attachProject: storeMutation({
        changes: ['pages'],
        input: r.projectLinkSchema,
        output: Schema.Void,
        run: d.attachProject
      }),
      detachProject: storeMutation({
        changes: ['pages'],
        input: r.projectLinkSchema,
        output: Schema.Void,
        run: d.detachProject
      }),
      attach: storeMutation({
        changes: ['pages'],
        input: r.linkSchema,
        output: Schema.Void,
        run: d.attach
      }),
      detach: storeMutation({
        changes: ['pages'],
        input: r.linkSchema,
        output: Schema.Void,
        run: d.detach
      }),
      retireHistory: storeMutation({
        changes: ['pages'],
        input: r.retireSchema,
        output: r.retirementPreviewSchema,
        run: (v) => d.retire(v.pageId, v.keepLatest, v.token, false, v.versionId)
      }),
      delete: storeMutation({
        changes: ['pages'],
        input: r.deleteSchema,
        output: Schema.Void,
        run: (v) => {
          d.retire(v.pageId, 0, v.token, true);
        }
      }),
      createGenerated: storeMutation({
        changes: ['pages'],
        input: e.createGeneratedSchema,
        output: e.createGeneratedOutcomeSchema,
        run: d.createGenerated
      }),
      publishGenerated: storeMutation({
        changes: ['pages'],
        input: e.publishSchema,
        output: e.editOutcomeSchema,
        run: d.publishGenerated
      })
    }
  };
}
