/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Verifies durable private chat identities for individual notebook notes.            │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Checks idempotent creation and separation from global chats.                           │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Tests exercise the production note service using a real temporary SQLite                 │
 * │ database.                                                                                │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { createTestDatabase } from '@study/db/testing';
import { testStable } from '@study/testing/vitest';
import { Effect } from 'effect';
import { expect } from 'vite-plus/test';

import { Notes } from '#server/features/notes/index';
import { ServerContext } from '#server/platform/database/context';
import { Database } from '#server/platform/database/database';

testStable(
  'note chats are distinct, durable, excluded from global chats and scoped to a notebook',
  async () => {
    const location = await createTestDatabase();
    const context = new ServerContext(await location.open());

    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* Notes;
          const a = yield* service.createNote({ title: 'Note A' });
          const b = yield* service.createNote({ title: 'Note B' });
          const first = yield* service.noteAssistant({ noteId: a.id });
          const repeated = yield* service.noteAssistant({ noteId: a.id });
          const second = yield* service.noteAssistant({ noteId: b.id });
          const global = yield* service.assistantNote();

          expect(repeated.id).toBe(first.id);
          expect(second.id).not.toBe(first.id);
          expect(global.id).not.toBe(first.id);
          expect(
            (yield* service.assistantChats({ limit: 100 })).items.map((item) => item.id)
          ).toEqual([global.id]);
          expect((yield* Effect.result(service.noteAssistant({ noteId: first.id })))._tag).toBe(
            'Failure'
          );
        }).pipe(Effect.provide(Notes.layer), Effect.provideService(Database, { store: context }))
      );
    } finally {
      context.close();
      await location.cleanup();
    }
  }
);
