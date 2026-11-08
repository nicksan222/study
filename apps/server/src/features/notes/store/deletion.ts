/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Persists idempotent note deletion barriers and content-free cleanup status.        │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Retains durable ownership and content-free retirement state.                           │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Feature policy uses public participants; native Workflow owns execution.                 │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { StudyError, errorKindSchema } from '@study/contracts/errors';
import { noteIdSchema } from '@study/contracts/ids';
import { noteDeletionSchema } from '@study/contracts/notes/deletion';
import { eq, sql } from '@study/db';
import * as s from '@study/db/schema';
import { Option, Schema } from 'effect';

import { defineStore, storeMutation, storeQuery } from '#server/platform/definitions/define-store';
import { unixSeconds } from '#server/platform/time/index';

import { makeContextRetirement } from './context-retirement.ts';

export const NoteDeletionStore = defineStore({
  name: 'study/NoteDeletionStore',
  entity: { singular: 'noteDeletion', plural: 'noteDeletions' },
  make: (resources) => {
    const { db, clock } = resources;
    const retirement = makeContextRetirement(resources);

    function read(id: typeof noteIdSchema.Type) {
      const row = db.orm
        .select()
        .from(s.note_deletions)
        .where(eq(s.note_deletions.note_id, id))
        .get();

      return row
        ? {
            noteId: id,
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
        noteDeletion: storeQuery({
          role: 'required',
          input: noteIdSchema,
          output: noteDeletionSchema,
          run: read
        }),
        findNoteDeletion: storeQuery({
          role: 'optional',
          input: noteIdSchema,
          output: Schema.Option(noteDeletionSchema),
          run: (id) => Option.fromNullishOr(read(id))
        })
      },
      mutations: {
        retainCorrelations: storeMutation({
          input: Schema.Struct({
            noteId: noteIdSchema,
            correlations: Schema.Array(Schema.String)
          }),
          output: Schema.Void,
          run: ({ noteId, correlations }) => {
            for (const id of correlations)
              db.orm
                .insert(s.note_deletion_correlations)
                .values({ correlation_id: id, note_id: noteId })
                .onConflictDoNothing()
                .run();
          }
        }),
        accept: storeMutation({
          input: Schema.Struct({ noteId: noteIdSchema, operationId: Schema.String }),
          output: noteDeletionSchema,
          run: ({ noteId, operationId }) => {
            if (!db.orm.select().from(s.notes).where(eq(s.notes.id, noteId)).get())
              throw new StudyError('not_found', 'Note is unavailable');

            db.orm
              .insert(s.note_deletions)
              .values({
                note_id: noteId,
                operation_id: operationId,
                status: 'pending',
                created_at: unixSeconds(clock)
              })
              .run();

            return read(noteId)!;
          }
        }),
        retireCaptures: storeMutation({
          input: Schema.Array(Schema.String),
          output: Schema.Void,
          run: (ids) => {
            for (const id of ids) {
              const captured = db.orm
                .select()
                .from(s.note_run_contexts)
                .where(eq(s.note_run_contexts.request_id, id))
                .get();

              if (captured)
                db.orm
                  .insert(s.note_retired_intents)
                  .values({
                    note_id: captured.note_id,
                    intent_key: captured.intent_key,
                    request_id: id,
                    reason: 'note_deleted'
                  })
                  .onConflictDoNothing()
                  .run();

              retirement.scrubRequest(id);
            }
          }
        }),
        removeNote: storeMutation({
          input: noteIdSchema,
          output: Schema.Void,
          run: (id) => {
            db.orm.delete(s.notes).where(eq(s.notes.id, id)).run();
          }
        }),
        retry: storeMutation({
          input: Schema.Struct({ noteId: noteIdSchema, pendingTerminal: Schema.Boolean }),
          output: noteDeletionSchema,
          run: ({ noteId: id, pendingTerminal }) => {
            const previous = read(id);

            if (!previous) throw new StudyError('not_found', 'Deletion is unavailable');

            if (previous.status === 'failed' || (previous.status === 'pending' && pendingTerminal))
              db.orm
                .update(s.note_deletions)
                .set({ status: 'pending', error_kind: null, attempt: previous.attempt + 1 })
                .where(eq(s.note_deletions.note_id, id))
                .run();

            return read(id)!;
          }
        }),
        settle: storeMutation({
          input: Schema.Struct({
            noteId: noteIdSchema,
            errorKind: Schema.NullOr(errorKindSchema),
            attempt: Schema.Int
          }),
          output: noteDeletionSchema,
          run: ({ noteId, errorKind, attempt }) => {
            const previous = read(noteId);

            if (!previous) throw new StudyError('not_found', 'Deletion is unavailable');

            if (previous.status === 'completed' || previous.attempt !== attempt) return previous;

            db.orm
              .update(s.note_deletions)
              .set({
                status: errorKind === null ? 'completed' : 'failed',
                error_kind: errorKind,
                completed_at: errorKind === null ? unixSeconds(clock) : null
              })
              .where(eq(s.note_deletions.note_id, noteId))
              .run();

            return read(noteId)!;
          }
        })
      }
    };
  }
});

/** Aggregate owned request identities, separate from deletion status queries. */
export const NoteDeletionOwnershipStore = defineStore({
  name: 'study/NoteDeletionOwnershipStore',
  entity: { singular: 'deletionOwnership', plural: 'deletionOwnerships' },
  make: ({ db }) => ({
    queries: {
      deletionOwnership: storeQuery({
        role: 'required',
        input: noteIdSchema,
        output: Schema.Struct({
          contextIds: Schema.Array(Schema.String),
          correlations: Schema.Array(Schema.String)
        }),
        run: (id) => {
          const contextIds = db.orm
            .select()
            .from(s.note_run_contexts)
            .where(
              sql`${s.note_run_contexts.note_id}=${id} OR EXISTS(SELECT 1 FROM json_each(${s.note_run_contexts.snapshot}, '$.additionalNoteIds') included WHERE CAST(included.value AS TEXT)=${String(id)})`
            )
            .all()
            .map((row) => row.request_id);
          const events = db.orm
            .select()
            .from(s.workflowEvents)
            .where(sql`json_extract(${s.workflowEvents.payload}, '$.noteId') = ${String(id)}`)
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
export const NoteDeletionCorrelationStore = defineStore({
  name: 'study/NoteDeletionCorrelationStore',
  entity: { singular: 'deletionCorrelation', plural: 'deletionCorrelations' },
  make: ({ db }) => ({
    queries: {
      deletionCorrelation: storeQuery({
        role: 'required',
        input: noteIdSchema,
        output: Schema.Struct({ correlations: Schema.Array(Schema.String) }),
        run: (id) => ({
          correlations: db.orm
            .select()
            .from(s.note_deletion_correlations)
            .where(eq(s.note_deletion_correlations.note_id, id))
            .all()
            .map((row) => row.correlation_id)
        })
      })
    },
    mutations: {}
  })
});
