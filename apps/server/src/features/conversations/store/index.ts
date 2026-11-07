/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Defines conversation persistence stores and their typed queries and mutations.     │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Exports typed store definitions consumed by the conversation service.                  │
 * │ - Keeps persistence inputs and results typed for service-layer composition.              │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Typed store helpers own database access; the conversations service applies policy and    │
 * │ composes these private operations.                                                       │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import {
  createSessionInputSchema,
  renameSessionInputSchema,
  sessionPageInputSchema
} from '@study/contracts/conversations/rpc';
import {
  ConversationMode,
  conversationModeSchema,
  sessionSchema
} from '@study/contracts/conversations/schemas';
import { StudyError } from '@study/contracts/errors';
import { sessionIdSchema } from '@study/contracts/ids';
import { and, desc, eq, lt, or, sql } from '@study/db';
import {
  sessions,
  projects,
  project_sessions,
  messages,
  recordings,
  session_documents,
  session_run_contexts,
  session_deletions
} from '@study/db/schema';
import { Option, Schema } from 'effect';

import { defineStore, storeMutation, storeQuery } from '#server/platform/definitions/define-store';
import { unixSeconds } from '#server/platform/time/index';

const resolvedMode = (mode: ConversationMode | undefined) => mode ?? ConversationMode.Notebook;

const row = (
  value: typeof sessions.$inferSelect,
  projectIds: readonly (typeof projects.$inferSelect.id)[]
) => ({
  projectIds,
  id: value.id,
  title: value.title,
  titleSource: value.title_source,
  archivedAt: value.archived_at,
  createdAt: value.created_at,
  updatedAt: value.updated_at
});

export const SessionStore = defineStore({
  name: 'study/ConversationSessionStore',
  entity: { singular: 'session', plural: 'sessions' },
  make: ({ db, clock }) => {
    const present = (value: typeof sessions.$inferSelect) =>
      row(
        value,
        db.orm
          .select()
          .from(project_sessions)
          .where(eq(project_sessions.session_id, value.id))
          .all()
          .map((link) => link.project_id)
      );

    return {
      queries: {
        session: storeQuery({
          role: 'required',
          input: sessionIdSchema,
          output: sessionSchema,
          run: (id) => {
            const value = db.orm.select().from(sessions).where(eq(sessions.id, id)).get();

            return value ? present(value) : null;
          }
        }),
        findSession: storeQuery({
          role: 'optional',
          input: sessionIdSchema,
          output: Schema.Option(sessionSchema),
          run: (id) =>
            Option.fromNullishOr(
              db.orm.select().from(sessions).where(eq(sessions.id, id)).get()
            ).pipe(Option.map(present))
        }),
        sessions: storeQuery({
          role: 'collection',
          input: sessionPageInputSchema,
          output: Schema.Array(sessionSchema),
          run: (input) =>
            db.orm
              .select()
              .from(sessions)
              .where(
                and(
                  eq(sessions.mode, ConversationMode.Notebook),
                  input.project === undefined
                    ? undefined
                    : input.project === null
                      ? sql`NOT EXISTS (SELECT 1 FROM ${project_sessions} WHERE ${project_sessions.session_id} = ${sessions.id})`
                      : sql`EXISTS (SELECT 1 FROM ${project_sessions} WHERE ${project_sessions.session_id} = ${sessions.id} AND ${project_sessions.project_id} = ${input.project})`,
                  input.before === undefined
                    ? undefined
                    : or(
                        lt(sessions.updated_at, input.before.updatedAt),
                        and(
                          eq(sessions.updated_at, input.before.updatedAt),
                          lt(sessions.id, input.before.id)
                        )
                      )
                )
              )
              .orderBy(desc(sessions.updated_at), desc(sessions.id))
              .limit(input.limit)
              .all()
              .map(present)
        })
      },
      mutations: {
        createSession: storeMutation({
          input: Schema.Struct({
            ...createSessionInputSchema.fields,
            titleSource: Schema.Literals(['user', 'provisional']),
            mode: Schema.optional(conversationModeSchema)
          }),
          output: sessionSchema,
          run: (input) => {
            const mode = resolvedMode(input.mode);
            const title = input.title.trim();

            if (!title || [...title].length > 200)
              throw new StudyError('invalid_input', 'invalid session title');

            const now = unixSeconds(clock);

            if (
              input.project !== undefined &&
              !db.orm.select().from(projects).where(eq(projects.id, input.project)).get()
            )
              throw new StudyError('not_found', 'Collection not found');

            // This lookup and insertion share the caller's immediate transaction.
            // A provisional title alone does not make a session with work reusable.
            const draft =
              input.titleSource === 'provisional'
                ? db.orm
                    .select()
                    .from(sessions)
                    .where(
                      and(
                        eq(sessions.title_source, 'provisional'),
                        sql`${sessions.archived_at} IS NULL`,
                        eq(sessions.mode, mode),
                        sql`json_array_length(${sessions.selection}) = 0`,
                        sql`NOT EXISTS (SELECT 1 FROM ${messages} WHERE ${messages.session_id} = ${sessions.id})`,
                        sql`NOT EXISTS (SELECT 1 FROM ${recordings} WHERE ${recordings.session_id} = ${sessions.id})`,
                        sql`NOT EXISTS (SELECT 1 FROM ${session_documents} WHERE ${session_documents.session_id} = ${sessions.id})`,
                        sql`NOT EXISTS (SELECT 1 FROM ${session_run_contexts} WHERE ${session_run_contexts.session_id} = ${sessions.id})`,
                        sql`NOT EXISTS (SELECT 1 FROM ${session_deletions} WHERE ${session_deletions.session_id} = ${sessions.id})`
                      )
                    )
                    .orderBy(desc(sessions.id))
                    .get()
                : undefined;

            if (draft) {
              db.orm
                .delete(project_sessions)
                .where(eq(project_sessions.session_id, draft.id))
                .run();

              if (input.project !== undefined)
                db.orm
                  .insert(project_sessions)
                  .values({ project_id: input.project, session_id: draft.id })
                  .run();

              const reused = db.orm
                .update(sessions)
                .set({ title, updated_at: now })
                .where(eq(sessions.id, draft.id))
                .returning()
                .get();

              if (!reused) throw new StudyError('not_found', 'session not found');

              return present(reused);
            }

            const created = db.orm
              .insert(sessions)
              .values({
                title,
                title_source: input.titleSource,
                mode: mode,
                created_at: now,
                updated_at: now
              })
              .returning()
              .get();

            if (input.project !== undefined)
              db.orm
                .insert(project_sessions)
                .values({ project_id: input.project, session_id: created.id })
                .run();

            return present(created);
          }
        }),
        renameSession: storeMutation({
          input: renameSessionInputSchema,
          output: sessionSchema,
          run: (input) => {
            const title = input.title.trim();

            if (!title || [...title].length > 200)
              throw new StudyError('invalid_input', 'invalid session title');

            const updated = db.orm
              .update(sessions)
              .set({
                title,
                title_source: 'user',
                context_revision: sql`${sessions.context_revision} + 1`,
                updated_at: unixSeconds(clock)
              })
              .where(eq(sessions.id, input.id))
              .returning()
              .get();

            if (!updated) throw new StudyError('not_found', 'session not found');

            return present(updated);
          }
        })
      }
    };
  }
});
