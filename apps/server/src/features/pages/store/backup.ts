/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Validates authored payloads and retires pending authority in backup copies.        │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Validates authored payloads and retires pending authority in backup copies.            │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Private synchronous persistence stays inside Pages ownership; callers own                │
 * │ transaction scope.                                                                       │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { StudyError } from '@study/contracts/errors';
import * as evidence from '@study/contracts/pages/evidence';
import { eq, isNull, sql } from '@study/db';
import * as s from '@study/db/schema';
import { Schema } from 'effect';

import { decodeTransformRequest } from '#server/features/pages/store/transforms';
import { defineStore, storeMutation, storeQuery } from '#server/platform/definitions/define-store';

import { makePageReads } from './reads.ts';

const annotationCodec = Schema.fromJsonString(Schema.toCodecJson(evidence.annotationSchema));

const assessmentCodec = Schema.fromJsonString(Schema.toCodecJson(evidence.assessmentSchema));

function assertAnnotationRecord(row: typeof s.page_annotation_revisions.$inferSelect) {
  const item = Schema.decodeUnknownSync(annotationCodec)(row.payload);

  if (
    item.id !== row.annotation_id ||
    item.revision !== row.revision ||
    item.target.pageId !== row.page_id ||
    item.target.range.versionId !== row.version_id ||
    item.target.range.snapshotId !== row.snapshot_id
  )
    throw new StudyError('invalid_input', 'Backup annotation identity is inconsistent');
}

export const PageBackupStore = defineStore({
  name: 'study/PageBackupStore',
  entity: { singular: 'backupPage', plural: 'backupPages' },
  make: (resources) => {
    const { db } = resources;
    const reads = makePageReads(resources);

    return {
      queries: {
        backupPage: storeQuery({
          role: 'required',
          input: Schema.Void,
          output: Schema.Boolean,
          run: () => {
            if (
              db.orm.get(
                sql`SELECT 1 FROM page_transform_requests WHERE cancelled=0 AND result_version_id IS NULL LIMIT 1`
              )
            )
              throw new StudyError(
                'invalid_input',
                'Backup contains pending authored generation authority'
              );

            if (
              db.orm.get(
                sql`SELECT 1 FROM note_context_pages c JOIN page_retirements r ON r.version_id=c.version_id LIMIT 1`
              )
            )
              throw new StudyError('invalid_input', 'Captured authored input has been retired');

            for (const row of db.orm.select().from(s.page_transform_requests).all())
              decodeTransformRequest(row);

            for (const row of db.orm.select().from(s.page_versions).all()) {
              if (
                !db.orm
                  .select()
                  .from(s.page_retirements)
                  .where(eq(s.page_retirements.version_id, row.id))
                  .get()
              )
                reads.version(row.id);
            }

            for (const row of db.orm.select().from(s.page_annotation_revisions).all())
              assertAnnotationRecord(row);

            for (const row of db.orm.select().from(s.page_citation_assessments).all())
              Schema.decodeUnknownSync(assessmentCodec)(row.payload);

            return true;
          }
        })
      },
      mutations: {
        prepareBackup: storeMutation({
          input: Schema.Void,
          output: Schema.Array(Schema.String),
          run: () =>
            db.orm
              .update(s.page_transform_requests)
              .set({ cancelled: true, error_kind: 'cancelled' })
              .where(isNull(s.page_transform_requests.result_version_id))
              .returning({ id: s.page_transform_requests.id })
              .all()
              .map((row) => row.id)
        })
      }
    };
  }
});
