/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Checks notebook identity without exposing persistence to tools.                    │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Reuses canonical feature services and schema-checked operations.                       │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Persistence policy remains in the owning feature service.                                │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { ConversationMode } from '@study/contracts/conversations/schemas';
import { sessionIdSchema } from '@study/contracts/ids';
import { and, eq } from '@study/db';
import { sessions } from '@study/db/schema';
import { Schema } from 'effect';

import { defineStore, storeQuery } from '#server/platform/definitions/define-store';

export const NotebookStore = defineStore({
  name: 'study/ConversationNotebookStore',
  entity: { singular: 'notebook', plural: 'notebooks' },
  make: ({ db }) => ({
    mutations: {},
    queries: {
      notebook: storeQuery({
        role: 'required',
        input: sessionIdSchema,
        output: Schema.Boolean,
        run: (id) =>
          Boolean(
            db.orm
              .select({ id: sessions.id })
              .from(sessions)
              .where(and(eq(sessions.id, id), eq(sessions.mode, ConversationMode.Notebook)))
              .get()
          )
      })
    }
  })
});
