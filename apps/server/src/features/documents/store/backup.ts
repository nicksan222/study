/** Validates authored payloads and retires pending authority in isolated backup copies. */
import * as evidence from '@study/contracts/documents/evidence';
import { StudyError } from '@study/contracts/errors';
import { eq, isNull, sql } from '@study/db';
import * as s from '@study/db/schema';
import { Schema } from 'effect';

import { decodeTransformRequest } from '#server/features/documents/decoders/transform-request';
import { defineStore, storeMutation, storeQuery } from '#server/platform/definitions/define-store';

import { makeDocumentReads } from './reads.ts';

const annotationCodec = Schema.fromJsonString(Schema.toCodecJson(evidence.annotationSchema));
const assessmentCodec = Schema.fromJsonString(Schema.toCodecJson(evidence.assessmentSchema));
function assertAnnotationRecord(row: typeof s.study_document_annotation_revisions.$inferSelect) {
  const item = Schema.decodeUnknownSync(annotationCodec)(row.payload);
  if (
    item.id !== row.annotation_id ||
    item.revision !== row.revision ||
    item.target.documentId !== row.document_id ||
    item.target.range.versionId !== row.version_id ||
    item.target.range.snapshotId !== row.snapshot_id
  )
    throw new StudyError('invalid_input', 'Backup annotation identity is inconsistent');
}
export const DocumentBackupStore = defineStore({
  name: 'study/DocumentBackupStore',
  entity: { singular: 'backupDocument', plural: 'backupDocuments' },
  make: (resources) => {
    const { db } = resources;
    const reads = makeDocumentReads(resources);
    return {
      queries: {
        backupDocument: storeQuery({
          role: 'required',
          input: Schema.Void,
          output: Schema.Boolean,
          run: () => {
            if (
              db.orm.get(
                sql`SELECT 1 FROM study_document_transform_requests WHERE cancelled=0 AND result_version_id IS NULL LIMIT 1`
              )
            )
              throw new StudyError(
                'invalid_input',
                'Backup contains pending authored generation authority'
              );
            if (
              db.orm.get(
                sql`SELECT 1 FROM session_context_documents c JOIN study_document_retirements r ON r.version_id=c.version_id LIMIT 1`
              )
            )
              throw new StudyError('invalid_input', 'Captured authored input has been retired');
            for (const row of db.orm.select().from(s.study_document_transform_requests).all())
              decodeTransformRequest(row);
            for (const row of db.orm.select().from(s.study_document_versions).all()) {
              if (
                !db.orm
                  .select()
                  .from(s.study_document_retirements)
                  .where(eq(s.study_document_retirements.version_id, row.id))
                  .get()
              )
                reads.version(row.id);
            }
            for (const row of db.orm.select().from(s.study_document_annotation_revisions).all())
              assertAnnotationRecord(row);
            for (const row of db.orm.select().from(s.study_document_citation_assessments).all())
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
              .update(s.study_document_transform_requests)
              .set({ cancelled: true, error_kind: 'cancelled' })
              .where(isNull(s.study_document_transform_requests.result_version_id))
              .returning({ id: s.study_document_transform_requests.id })
              .all()
              .map((row) => row.id)
        })
      }
    };
  }
});
