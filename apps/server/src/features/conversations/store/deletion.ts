/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Persists idempotent session deletion barriers and content-free cleanup status.     │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Retains durable ownership and content-free retirement state.                           │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Feature policy uses public participants; native Workflow owns execution.                 │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { sessionDeletionSchema } from '@study/contracts/conversations/deletion';
import { StudyError, errorKindSchema } from '@study/contracts/errors';
import { sessionIdSchema } from '@study/contracts/ids';
import { eq, sql } from '@study/db';
import * as s from '@study/db/schema';
import { Option, Schema } from 'effect';

import { defineStore, storeMutation, storeQuery } from '#server/platform/definitions/define-store';
import { unixSeconds } from '#server/platform/time/index';

export const SessionDeletionStore = defineStore({
  name: 'study/SessionDeletionStore',
  entity: { singular: 'sessionDeletion', plural: 'sessionDeletions' },
  make: ({ db, clock }) => {
    function read(id: typeof sessionIdSchema.Type) {
      const row = db.orm
        .select()
        .from(s.session_deletions)
        .where(eq(s.session_deletions.session_id, id))
        .get();

      return row
        ? {
            sessionId: id,
            operationId: row.operation_id,
            status: row.status,
            errorKind:
              row.error_kind === null
                ? null
                : Schema.decodeUnknownSync(errorKindSchema)(row.error_kind),
            attempt: Number(row.attempt),
            completedAt: row.completed_at
          }
        : undefined;
    }

    return {
      queries: {
        sessionDeletion: storeQuery({
          role: 'required',
          input: sessionIdSchema,
          output: sessionDeletionSchema,
          run: read
        }),
        findSessionDeletion: storeQuery({
          role: 'optional',
          input: sessionIdSchema,
          output: Schema.Option(sessionDeletionSchema),
          run: (id) => Option.fromNullishOr(read(id))
        })
      },
      mutations: {
        retainCorrelations: storeMutation({
          input: Schema.Struct({
            sessionId: sessionIdSchema,
            correlations: Schema.Array(Schema.String)
          }),
          output: Schema.Void,
          run: ({ sessionId, correlations }) => {
            for (const id of correlations)
              db.orm
                .insert(s.session_deletion_correlations)
                .values({ correlation_id: id, session_id: sessionId })
                .onConflictDoNothing()
                .run();
          }
        }),
        accept: storeMutation({
          input: Schema.Struct({ sessionId: sessionIdSchema, operationId: Schema.String }),
          output: sessionDeletionSchema,
          run: ({ sessionId, operationId }) => {
            if (!db.orm.select().from(s.sessions).where(eq(s.sessions.id, sessionId)).get())
              throw new StudyError('not_found', 'Session is unavailable');

            db.orm
              .insert(s.session_deletions)
              .values({
                session_id: sessionId,
                operation_id: operationId,
                status: 'pending',
                created_at: unixSeconds(clock)
              })
              .run();

            return read(sessionId)!;
          }
        }),
        removeConversation: storeMutation({
          input: sessionIdSchema,
          output: Schema.Void,
          run: (id) => {
            db.orm.delete(s.sessions).where(eq(s.sessions.id, id)).run();
          }
        }),
        retry: storeMutation({
          input: Schema.Struct({ sessionId: sessionIdSchema, pendingTerminal: Schema.Boolean }),
          output: sessionDeletionSchema,
          run: ({ sessionId: id, pendingTerminal }) => {
            const previous = read(id);

            if (!previous) throw new StudyError('not_found', 'Deletion is unavailable');

            if (previous.status === 'failed' || (previous.status === 'pending' && pendingTerminal))
              db.orm
                .update(s.session_deletions)
                .set({ status: 'pending', error_kind: null, attempt: previous.attempt + 1 })
                .where(eq(s.session_deletions.session_id, id))
                .run();

            return read(id)!;
          }
        }),
        settle: storeMutation({
          input: Schema.Struct({
            sessionId: sessionIdSchema,
            errorKind: Schema.NullOr(errorKindSchema),
            attempt: Schema.Int
          }),
          output: sessionDeletionSchema,
          run: ({ sessionId, errorKind, attempt }) => {
            const previous = read(sessionId);

            if (!previous) throw new StudyError('not_found', 'Deletion is unavailable');

            if (previous.status === 'completed' || previous.attempt !== attempt) return previous;

            db.orm
              .update(s.session_deletions)
              .set({
                status: errorKind === null ? 'completed' : 'failed',
                error_kind: errorKind,
                completed_at: errorKind === null ? unixSeconds(clock) : null
              })
              .where(eq(s.session_deletions.session_id, sessionId))
              .run();

            return read(sessionId)!;
          }
        })
      }
    };
  }
});

/** Aggregate owned request identities, separate from deletion status queries. */
export const SessionDeletionOwnershipStore = defineStore({
  name: 'study/SessionDeletionOwnershipStore',
  entity: { singular: 'deletionOwnership', plural: 'deletionOwnerships' },
  make: ({ db }) => ({
    queries: {
      deletionOwnership: storeQuery({
        role: 'required',
        input: sessionIdSchema,
        output: Schema.Struct({
          contextIds: Schema.Array(Schema.String),
          correlations: Schema.Array(Schema.String)
        }),
        run: (id) => {
          const contextIds = db.orm
            .select()
            .from(s.session_run_contexts)
            .where(eq(s.session_run_contexts.session_id, id))
            .all()
            .map((row) => row.request_id);
          const events = db.orm
            .select()
            .from(s.workflowEvents)
            .where(sql`json_extract(${s.workflowEvents.payload}, '$.sessionId') = ${String(id)}`)
            .all();

          return {
            contextIds,
            correlations: [...new Set([...contextIds, ...events.map((row) => row.correlationId)])]
          };
        }
      })
    },
    mutations: {}
  })
});

/** Read the retained correlation set as one aggregate, not an unbounded page. */
export const SessionDeletionCorrelationStore = defineStore({
  name: 'study/SessionDeletionCorrelationStore',
  entity: { singular: 'deletionCorrelation', plural: 'deletionCorrelations' },
  make: ({ db }) => ({
    queries: {
      deletionCorrelation: storeQuery({
        role: 'required',
        input: sessionIdSchema,
        output: Schema.Struct({ correlations: Schema.Array(Schema.String) }),
        run: (id) => ({
          correlations: db.orm
            .select()
            .from(s.session_deletion_correlations)
            .where(eq(s.session_deletion_correlations.session_id, id))
            .all()
            .map((row) => row.correlation_id)
        })
      })
    },
    mutations: {}
  })
});
