/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Persists bounded history intents, version barriers and exact publication           │
 * │ ownership.                                                                               │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Selects retained candidates and protects current, source and proposal roots.           │
 * │ - Removes accepted bodies while retaining immutable version identities.                  │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Materials owns its proof tables and content; feature participants own their private      │
 * │ rows.                                                                                    │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { createHash } from 'node:crypto';

import { StudyError, errorKindSchema } from '@study/contracts/errors';
import * as h from '@study/contracts/materials/history';
import { eq, and, desc, inArray } from '@study/db';
import * as s from '@study/db/schema';
import { Schema, Option } from 'effect';

import { defineStore, storeQuery, storeMutation } from '#server/platform/definitions/define-store';
import type { StoreResources } from '#server/platform/definitions/define-store';
import { unixSeconds } from '#server/platform/time/index';
import { decodeEvent } from '#server/platform/workflows/events';

import { makeContent } from './content.ts';
import { makeHistoryBodyBytes } from './history-bytes.ts';
import { makeReads, required } from './reads.ts';

export function historyHash(value: unknown) {
  return createHash('sha256')
    .update(JSON.stringify(value, (_, v) => (typeof v === 'bigint' ? String(v) : v)))
    .digest('hex');
}

function historyPublications(db: StoreResources['db'], ids: typeof h.historyVersionIdsSchema.Type) {
  return db.orm
    .select()
    .from(s.workflowEvents)
    .where(eq(s.workflowEvents.type, 'MaterialPublished'))
    .all()
    .filter((row) => {
      if (row.payload === '{}') return false;

      const event = decodeEvent(row.payload);

      return event.type === 'MaterialPublished' && ids.includes(event.materialVersionId);
    });
}

function makeHistory(resources: StoreResources) {
  const { db, clock } = resources;

  const reads = makeReads(resources);
  const historyBodyBytes = makeHistoryBodyBytes(resources);

  const { removeContent } = makeContent(resources);

  const idsCodec = Schema.fromJsonString(Schema.toCodecJson(h.historyVersionIdsSchema));

  function status(operationId: string) {
    const row = required(
      db.orm
        .select()
        .from(s.material_history_prunes)
        .where(eq(s.material_history_prunes.operation_id, operationId))
        .get()
    );

    return {
      operationId,
      materialId: row.material_id,
      policy: { keepLatest: Number(row.keep_latest) },
      candidateIds: Schema.decodeUnknownSync(idsCodec)(row.selection),
      status: row.status,
      attempt: Number(row.attempt),
      errorKind:
        row.error_kind === null ? null : Schema.decodeUnknownSync(errorKindSchema)(row.error_kind),
      completedAt: row.completed_at
    };
  }

  function preview(input: typeof h.historyScopeSchema.Type) {
    reads.materialRow(input.materialId);

    const versions = db.orm
      .select()
      .from(s.material_versions)
      .where(eq(s.material_versions.material_id, input.materialId))
      .orderBy(desc(s.material_versions.number), desc(s.material_versions.id))
      .all();

    const pruned = db.orm
      .select()
      .from(s.material_history_members)
      .all()
      .map((v) => v.version_id);

    const retained = versions.filter((v) => !pruned.includes(v.id));

    const latest = retained
      .filter((v) => v.status === 'published')
      .slice(0, input.policy.keepLatest)
      .map((v) => v.id);

    const protectedVersions: (typeof h.historyPreviewSchema.Type)['protected'][number][] = [];
    const eligible = retained.filter((version) => {
      const reason =
        version.status === 'draft' ? 'draft' : latest.includes(version.id) ? 'keep_latest' : null;

      if (reason !== null) protectedVersions.push({ versionId: version.id, reason });

      return reason === null;
    });

    // Oldest first; another explicit preview is required for each bounded batch.
    const candidateIds = eligible
      .toReversed()
      .slice(0, 100)
      .map((v) => v.id);

    const references = db.orm
      .select()
      .from(s.material_version_parents)
      .where(inArray(s.material_version_parents.parent_version_id, candidateIds))
      .all()
      .map((row) => ({
        versionId: row.parent_version_id,
        dependentVersionId: row.version_id,
        relationship: 'parent' as const
      }));
    const outputs = versions
      .filter((v) => candidateIds.includes(v.id) && v.generation_request_id !== null)
      .map((v) => v.generation_request_id!);

    const requests = db.orm
      .select()
      .from(s.material_generation_requests)
      .where(inArray(s.material_generation_requests.id, outputs))
      .all();

    const publications = historyPublications(db, candidateIds);

    const citations = db.orm
      .select()
      .from(s.material_evidence_citations)
      .where(inArray(s.material_evidence_citations.version_id, candidateIds))
      .all();

    const bodies = candidateIds.map((id) => reads.readVersion(id));

    const removedBodyBytes = historyBodyBytes(candidateIds);

    const value = {
      ...input,
      candidateIds,
      hasMore: eligible.length > 100,
      protected: protectedVersions,
      references,
      privateRequestIds: [...new Set([...outputs, ...publications.map((e) => e.correlationId)])],
      removedBodyBytes,
      byteSemantics: 'learning_body_columns' as const
    };

    return {
      ...value,
      token: historyHash({
        value,
        versions,
        bodies,
        requests,
        publications,
        citations
      })
    };
  }

  function scrub(operationId: string) {
    const ids = status(operationId).candidateIds;

    for (const id of ids) {
      removeContent(id);

      db.orm
        .update(s.material_versions)
        .set({ instruction: null, language: null })
        .where(eq(s.material_versions.id, id))
        .run();
    }
  }

  return { db, clock, idsCodec, status, preview, scrub };
}

export const MaterialHistoryStore = defineStore({
  name: 'study/MaterialHistoryStore',
  entity: { singular: 'materialHistory', plural: 'materialHistories' },
  make: (resources) => {
    const { db, clock, idsCodec, status, scrub } = makeHistory(resources);

    return {
      queries: {
        materialHistory: storeQuery({
          role: 'required',
          input: h.historyOperationKeySchema,
          output: h.historyPruneSchema,
          run: ({ operationId }) => status(operationId)
        }),
        findMaterialHistory: storeQuery({
          role: 'optional',
          input: h.historyOperationKeySchema,
          output: Schema.Option(h.historyPruneSchema),
          run: ({ operationId }) =>
            db.orm
              .select()
              .from(s.material_history_prunes)
              .where(eq(s.material_history_prunes.operation_id, operationId))
              .get()
              ? Option.some(status(operationId))
              : Option.none()
        })
      },
      mutations: {
        accept: storeMutation({
          input: h.requestHistoryPruneSchema,
          output: h.historyPruneSchema,
          run: (input) => {
            const previous = db.orm
              .select()
              .from(s.material_history_prunes)
              .where(eq(s.material_history_prunes.operation_id, input.operationId))
              .get();

            if (previous) {
              if (
                previous.token !== input.token ||
                previous.material_id !== input.materialId ||
                Number(previous.keep_latest) !== input.policy.keepLatest ||
                previous.selection !== Schema.encodeSync(idsCodec)(input.candidateIds)
              )
                throw new StudyError('invalid_input', 'History operation scope changed');

              return status(input.operationId);
            }

            makeReads(resources).materialRow(input.materialId);

            db.orm
              .insert(s.material_history_prunes)
              .values({
                operation_id: input.operationId,
                material_id: input.materialId,
                keep_latest: input.policy.keepLatest,
                token: input.token,
                selection: Schema.encodeSync(idsCodec)(input.candidateIds),
                status: 'pending',
                created_at: unixSeconds(clock)
              })
              .run();

            for (const versionId of input.candidateIds)
              db.orm
                .insert(s.material_history_members)
                .values({ version_id: versionId, operation_id: input.operationId })
                .run();

            return status(input.operationId);
          }
        }),
        retain: storeMutation({
          input: Schema.Struct({
            ...h.historyOperationKeySchema.fields,
            requestIds: Schema.Array(Schema.String),
            kind: Schema.Literals(['generation', 'learning', 'publication'])
          }),
          output: Schema.Void,
          run: ({ operationId, requestIds, kind }) => {
            for (const requestId of requestIds) {
              const old = db.orm
                .select()
                .from(s.material_history_requests)
                .where(eq(s.material_history_requests.request_id, requestId))
                .get();

              if (old && old.operation_id !== operationId) {
                if (status(old.operation_id).status !== 'completed')
                  throw new StudyError(
                    'invalid_input',
                    'History cleanup overlaps an active operation'
                  );

                continue;
              }

              db.orm
                .insert(s.material_history_requests)
                .values({ operation_id: operationId, request_id: requestId, kind })
                .onConflictDoNothing()
                .run();
            }
          }
        }),
        scrub: storeMutation({
          input: h.historyOperationKeySchema,
          output: Schema.Void,
          run: ({ operationId }) => scrub(operationId)
        }),
        retry: storeMutation({
          input: Schema.Struct({
            ...h.historyOperationKeySchema.fields,
            pendingTerminal: Schema.Boolean
          }),
          output: h.historyPruneSchema,
          run: ({ operationId, pendingTerminal }) => {
            const old = status(operationId);

            if (old.status === 'failed' || (old.status === 'pending' && pendingTerminal))
              db.orm
                .update(s.material_history_prunes)
                .set({ status: 'pending', error_kind: null, attempt: old.attempt + 1 })
                .where(eq(s.material_history_prunes.operation_id, operationId))
                .run();

            return status(operationId);
          }
        }),
        settle: storeMutation({
          input: Schema.Struct({
            ...h.historyOperationKeySchema.fields,
            attempt: Schema.Int,
            errorKind: Schema.NullOr(errorKindSchema)
          }),
          output: h.historyPruneSchema,
          run: ({ operationId, attempt, errorKind }) => {
            const old = status(operationId);

            if (old.status === 'completed' || old.attempt !== attempt) return old;

            db.orm
              .update(s.material_history_prunes)
              .set({
                status: errorKind === null ? 'completed' : 'failed',
                error_kind: errorKind,
                completed_at: errorKind === null ? unixSeconds(clock) : null
              })
              .where(
                and(
                  eq(s.material_history_prunes.operation_id, operationId),
                  eq(s.material_history_prunes.attempt, attempt)
                )
              )
              .run();

            return status(operationId);
          }
        })
      }
    };
  }
});

export const MaterialHistoryPreviewStore = defineStore({
  name: 'study/MaterialHistoryPreviewStore',
  entity: { singular: 'materialHistoryPreview', plural: 'materialHistoryPreviews' },
  make: (resources) => ({
    queries: {
      materialHistoryPreview: storeQuery({
        role: 'required',
        input: h.historyScopeSchema,
        output: h.historyPreviewSchema,
        run: makeHistory(resources).preview
      })
    },
    mutations: {}
  })
});

export const MaterialHistoryOwnershipStore = defineStore({
  name: 'study/MaterialHistoryOwnershipStore',
  entity: { singular: 'materialHistoryOwnership', plural: 'materialHistoryOwnerships' },
  make: ({ db }) => ({
    queries: {
      materialHistoryOwnership: storeQuery({
        role: 'required',
        input: h.historyOperationKeySchema,
        output: Schema.Array(Schema.String),
        run: ({ operationId }) =>
          db.orm
            .select()
            .from(s.material_history_requests)
            .where(eq(s.material_history_requests.operation_id, operationId))
            .all()
            .map((r) => r.request_id)
      })
    },
    mutations: {}
  })
});

export const MaterialHistoryPublicationStore = defineStore({
  name: 'study/MaterialHistoryPublicationStore',
  entity: { singular: 'materialHistoryPublication', plural: 'materialHistoryPublications' },
  make: ({ db }) => ({
    queries: {
      materialHistoryPublication: storeQuery({
        role: 'required',
        input: h.historyVersionIdsSchema,
        output: Schema.Array(Schema.String),
        run: (ids) => historyPublications(db, ids).map((row) => row.correlationId)
      })
    },
    mutations: {}
  })
});
