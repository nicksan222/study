/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Verifies durable private chat identities for individual notebook sessions.         │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Checks idempotent creation and separation from global chats.                           │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Tests exercise the production conversation service using a real temporary SQLite         │
 * │ database.                                                                                │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { createTestDatabase } from '@study/db/testing';
import { testStable } from '@study/testing/vitest';
import { Effect } from 'effect';
import { expect } from 'vite-plus/test';

import { Conversations } from '#server/features/conversations/index';
import { ServerContext } from '#server/platform/database/context';
import { Database } from '#server/platform/database/database';

testStable(
  'session chats are distinct, durable, excluded from global chats and scoped to a notebook',
  async () => {
    const location = createTestDatabase();
    const context = new ServerContext(location.open());

    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* Conversations;
          const a = yield* service.createSession({ title: 'Session A' });
          const b = yield* service.createSession({ title: 'Session B' });
          const first = yield* service.sessionAssistant({ sessionId: a.id });
          const repeated = yield* service.sessionAssistant({ sessionId: a.id });
          const second = yield* service.sessionAssistant({ sessionId: b.id });
          const global = yield* service.assistantSession();

          expect(repeated.id).toBe(first.id);
          expect(second.id).not.toBe(first.id);
          expect(global.id).not.toBe(first.id);
          expect(
            (yield* service.assistantChats({ limit: 100 })).items.map((item) => item.id)
          ).toEqual([global.id]);
          expect(
            (yield* Effect.result(service.sessionAssistant({ sessionId: first.id })))._tag
          ).toBe('Failure');
        }).pipe(
          Effect.provide(Conversations.layer),
          Effect.provideService(Database, { store: context })
        )
      );
    } finally {
      context.close();
      location.cleanup();
    }
  }
);
