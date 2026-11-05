/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Persists exact Document transform captures, publication receipts and guarded       │
 * │ retries.                                                                                 │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Persists exact Document transform captures, publication receipts and guarded retries.  │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Private synchronous persistence stays inside Documents ownership; callers own            │
 * │ transaction scope.                                                                       │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import * as t from '@study/contracts/documents/transform';
import { StudyError } from '@study/contracts/errors';
import { sessionIdSchema } from '@study/contracts/ids';
import { and, eq, lt, desc, inArray, or } from '@study/db';
import { study_document_transform_requests as requests } from '@study/db/schema';
import { Schema, Option } from 'effect';

import { intentHash } from '#server/features/documents/decoders/intent';
import {
  transformRequestCodec as requestCodec,
  transformReportCodec as reportCodec
} from '#server/features/documents/decoders/transform-request';
import { defineStore, storeMutation, storeQuery } from '#server/platform/definitions/define-store';
import { unixSeconds } from '#server/platform/time/index';

export function decodeTransformRequest(row: typeof requests.$inferSelect) {
  const request = Schema.decodeUnknownSync(requestCodec)(row.request);

  if (request.contextRequestId !== row.context_request_id)
    throw new StudyError('invalid_input', 'Document generation capture identity is inconsistent');

  return Schema.decodeUnknownSync(t.transformSnapshotSchema)({
    ...request,
    id: row.id,
    sessionId: row.session_id,
    instruction: row.instruction,
    eventId: row.event_id,
    cancelled: row.cancelled,
    errorKind: row.error_kind,
    resultVersionId: row.result_version_id,
    report: row.report === null ? null : Schema.decodeUnknownSync(reportCodec)(row.report)
  });
}

export const DocumentTransformsStore = defineStore({
  name: 'study/DocumentTransformsStore',
  entity: { singular: 'transform', plural: 'transforms' },
  make: ({ db, clock }) => {
    function read({ requestId }: typeof t.transformKeySchema.Type) {
      const row = db.orm.select().from(requests).where(eq(requests.id, requestId)).get();

      if (!row) throw new StudyError('not_found', 'Document generation is unavailable');

      return decodeTransformRequest(row);
    }

    return {
      queries: {
        findTransform: storeQuery({
          role: 'optional',
          input: t.transformKeySchema,
          output: Schema.Option(t.transformSnapshotSchema),
          run: (v) =>
            db.orm
              .select({ id: requests.id })
              .from(requests)
              .where(eq(requests.id, v.requestId))
              .get()
              ? Option.some(read(v))
              : Option.none()
        }),
        transform: storeQuery({
          role: 'required',
          input: t.transformKeySchema,
          output: t.transformSnapshotSchema,
          run: read
        }),
        transforms: storeQuery({
          role: 'collection',
          input: Schema.Struct({
            sessionId: sessionIdSchema,
            limit: Schema.Int,
            before: Schema.optional(Schema.String)
          }),
          output: Schema.Array(t.transformSnapshotSchema),
          run: ({ sessionId, limit, before }) =>
            db.orm
              .select({ requestId: requests.id })
              .from(requests)
              .where(
                and(
                  eq(requests.session_id, sessionId),
                  before === undefined ? undefined : lt(requests.id, before)
                )
              )
              .orderBy(desc(requests.id))
              .limit(limit)
              .all()
              .map(read)
        })
      },
      mutations: {
        retireSessionRequests: storeMutation({
          input: Schema.Struct({
            sessionId: sessionIdSchema,
            contextIds: Schema.Array(Schema.String)
          }),
          output: Schema.Array(Schema.String),
          run: (v) => {
            const rows = db.orm
              .select()
              .from(requests)
              .where(
                or(
                  eq(requests.session_id, v.sessionId),
                  inArray(requests.context_request_id, [...v.contextIds])
                )
              )
              .all();

            for (const row of rows)
              if (row.result_version_id === null)
                db.orm
                  .update(requests)
                  .set({ cancelled: true, error_kind: 'cancelled' })
                  .where(eq(requests.id, row.id))
                  .run();

            return rows.map((row) => row.id);
          }
        }),
        requestTransform: storeMutation({
          input: Schema.Struct({
            ...t.storedTransformRequestSchema.fields,
            sessionId: Schema.NullOr(sessionIdSchema),
            instruction: Schema.String
          }),
          output: Schema.Struct({ created: Schema.Boolean, request: t.transformSnapshotSchema }),
          run: (value) => {
            const requestId = `document/${value.contextRequestId}`;
            const hash = intentHash(
              Schema.Struct({
                ...t.storedTransformRequestSchema.fields,
                sessionId: Schema.NullOr(sessionIdSchema),
                instruction: Schema.String
              }),
              value
            );
            const existing = db.orm.select().from(requests).where(eq(requests.id, requestId)).get();

            if (existing && existing.intent_hash !== hash)
              throw new StudyError('invalid_input', 'Document request already has another intent');

            if (!existing)
              db.orm
                .insert(requests)
                .values({
                  id: requestId,
                  context_request_id: value.contextRequestId,
                  session_id: value.sessionId,
                  request: Schema.encodeSync(requestCodec)(value),
                  intent_hash: hash,
                  instruction: value.instruction,
                  event_id: requestId,
                  created_at: unixSeconds(clock)
                })
                .run();

            return { created: !existing, request: read({ requestId }) };
          }
        }),
        finishTransform: storeMutation({
          input: Schema.Struct({
            ...t.transformPublicationSchema.fields,
            versionId: t.transformSnapshotSchema.fields.resultVersionId
          }),
          output: t.transformSnapshotSchema,
          run: (value) => {
            const old = read(value);
            const hash = intentHash(t.transformPublicationSchema, {
              ...value,
              citations: [...value.citations].sort((a, b) => a.marker - b.marker)
            });
            const committed = db.orm
              .select({ hash: requests.result_hash })
              .from(requests)
              .where(eq(requests.id, value.requestId))
              .get();

            if (old.resultVersionId !== null && committed?.hash !== hash)
              throw new StudyError(
                'invalid_input',
                'Document result differs from its publication receipt'
              );

            if (old.cancelled || old.eventId !== value.generationEventId)
              throw new StudyError('cancelled', 'Document generation is no longer active');

            if (old.resultVersionId !== null && old.resultVersionId !== value.versionId)
              throw new StudyError('invalid_input', 'Document generation already published');

            db.orm
              .update(requests)
              .set({
                result_version_id: value.versionId,
                result_hash: hash,
                report: Schema.encodeSync(reportCodec)(value.report),
                error_kind: null
              })
              .where(eq(requests.id, value.requestId))
              .run();

            return read(value);
          }
        }),
        changeTransform: storeMutation({
          input: Schema.Struct({
            ...t.transformKeySchema.fields,
            eventId: Schema.optional(Schema.String),
            cancel: Schema.Boolean,
            errorKind: t.transformSnapshotSchema.fields.errorKind
          }),
          output: t.transformSnapshotSchema,
          run: (value) => {
            const old = read(value);

            if (old.resultVersionId !== null) return old;

            db.orm
              .update(requests)
              .set({
                event_id: value.eventId ?? old.eventId,
                cancelled: value.cancel || old.cancelled,
                error_kind: value.errorKind
              })
              .where(eq(requests.id, value.requestId))
              .run();

            return read(value);
          }
        })
      }
    };
  }
});
