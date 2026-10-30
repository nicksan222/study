import {
  createSessionInputSchema,
  renameSessionInputSchema,
  sessionPageInputSchema
} from '@study/contracts/conversations/rpc';
import { sessionSchema } from '@study/contracts/conversations/schemas';
import { StudyError } from '@study/contracts/errors';
import { sessionIdSchema } from '@study/contracts/ids';
import { and, desc, eq, lt, or } from '@study/db';
import { sessions } from '@study/db/schema';
import { Option, Schema } from 'effect';

import { defineStore, storeMutation, storeQuery } from '#server/platform/definitions/define-store';
import { unixSeconds } from '#server/platform/time/index';

const row = (value: typeof sessions.$inferSelect) => ({
  id: value.id,
  projectId: value.project_id,
  title: value.title,
  titleSource: value.title_source,
  createdAt: value.created_at,
  updatedAt: value.updated_at
});

export const SessionStore = defineStore({
  name: 'study/ConversationSessionStore',
  entity: { singular: 'session', plural: 'sessions' },
  make: ({ db, clock }) => ({
    queries: {
      session: storeQuery({
        role: 'required',
        input: sessionIdSchema,
        output: sessionSchema,
        run: (id) => {
          const value = db.orm.select().from(sessions).where(eq(sessions.id, id)).get();

          return value ? row(value) : null;
        }
      }),
      findSession: storeQuery({
        role: 'optional',
        input: sessionIdSchema,
        output: Schema.Option(sessionSchema),
        run: (id) =>
          Option.fromNullishOr(
            db.orm.select().from(sessions).where(eq(sessions.id, id)).get()
          ).pipe(Option.map(row))
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
            .orderBy(desc(sessions.updated_at), desc(sessions.id))
            .limit(input.limit)
            .all()
            .map(row)
      })
    },
    mutations: {
      createSession: storeMutation({
        input: Schema.Struct({
          ...createSessionInputSchema.fields,
          titleSource: Schema.Literals(['user', 'provisional'])
        }),
        output: sessionSchema,
        run: (input) => {
          const title = input.title.trim();

          if (!title || [...title].length > 200)
            throw new StudyError('invalid_input', 'invalid session title');

          const now = unixSeconds(clock);

          return row(
            db.orm
              .insert(sessions)
              .values({
                project_id: input.project,
                title,
                title_source: input.titleSource,
                created_at: now,
                updated_at: now
              })
              .returning()
              .get()
          );
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
            .set({ title, title_source: 'user', updated_at: unixSeconds(clock) })
            .where(eq(sessions.id, input.id))
            .returning()
            .get();

          if (!updated) throw new StudyError('not_found', 'session not found');

          return row(updated);
        }
      }),
      deleteSession: storeMutation({
        input: sessionIdSchema,
        output: Schema.Boolean,
        run: (id) => db.orm.delete(sessions).where(eq(sessions.id, id)).run().changes !== 0n
      })
    }
  })
});
