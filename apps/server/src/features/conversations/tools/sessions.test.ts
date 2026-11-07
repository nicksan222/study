/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Verifies notebook tools reuse named sessions and protect Assistant conversations.  │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Tests exact-name reuse, pagination, subject memberships and history through services.  │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Uses isolated SQLite fixtures and real feature services.                                 │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { createTestDatabase } from '@study/db/testing';
import { testStable } from '@study/testing/vitest';
import { Effect } from 'effect';
import { assert, expect } from 'vite-plus/test';

import { Conversations } from '#server/features/conversations/index';
import { ServerContext } from '#server/platform/database/context';
import { Database } from '#server/platform/database/database';

import { sessionTools } from './sessions.ts';
import { subjectTools } from './subjects.ts';

const environment = { language: 'en', searchSources: () => Effect.succeed([]) };

testStable(
  'notebook tools scope exact-name retries, page history and preserve memberships',
  async () => {
    const location = createTestDatabase();
    const context = new ServerContext(location.open());

    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const subject = yield* subjectTools.create_subject.execute(
            { name: 'Biology' },
            environment
          );
          const first = yield* sessionTools.create_session.execute(
            { title: ' Revision ' },
            environment
          );
          const service = yield* Conversations;

          // The reusable session must be found beyond the first page.
          for (let i = 0; i < 100; i++) yield* service.createSession({ title: `Other ${i}` });

          const retry = yield* sessionTools.create_session.execute(
            { title: 'Revision' },
            environment
          );

          expect(retry.id).toBe(first.id);
          const scoped = yield* sessionTools.create_session.execute(
            { title: 'Revision', project: subject.id },
            environment
          );

          expect(scoped.id).not.toBe(first.id);
          expect(
            (yield* sessionTools.create_session.execute(
              { title: 'Revision', project: subject.id },
              environment
            )).id
          ).toBe(scoped.id);
          yield* sessionTools.link_session_subject.execute(
            { sessionId: first.id, projectId: subject.id },
            environment
          );
          yield* sessionTools.link_session_subject.execute(
            { sessionId: first.id, projectId: subject.id },
            environment
          );
          expect(
            (yield* sessionTools.read_session.execute({ id: first.id }, environment)).projectIds
          ).toStrictEqual([subject.id]);
          yield* sessionTools.unlink_session_subject.execute(
            { sessionId: first.id, projectId: subject.id },
            environment
          );
          expect(
            (yield* sessionTools.read_session.execute({ id: first.id }, environment)).projectIds
          ).toStrictEqual([]);
          yield* service.postMessage({ sessionId: first.id, text: 'First note' });
          yield* service.postMessage({ sessionId: first.id, text: 'Second note' });
          const page = yield* sessionTools.read_session_history.execute(
            { sessionId: first.id, limit: 1 },
            environment
          );

          assert.ok(page.next);
          const older = yield* sessionTools.read_session_history.execute(
            { sessionId: first.id, limit: 1, before: page.next },
            environment
          );

          expect(older.items).toHaveLength(1);
          expect(older.items[0].id).not.toBe(page.items[0].id);
          expect(older.next).toBeNull();
          expect(
            (yield* sessionTools.rename_session.execute(
              { id: first.id, title: 'Exam review' },
              environment
            )).title
          ).toBe('Exam review');
          const assistant = yield* service.assistantSession();

          for (const operation of [
            sessionTools.read_session
              .execute({ id: assistant.id }, environment)
              .pipe(Effect.asVoid),
            sessionTools.rename_session
              .execute({ id: assistant.id, title: 'Wrong' }, environment)
              .pipe(Effect.asVoid),
            sessionTools.read_session_history
              .execute({ sessionId: assistant.id, limit: 10 }, environment)
              .pipe(Effect.asVoid),
            sessionTools.link_session_subject
              .execute({ sessionId: assistant.id, projectId: subject.id }, environment)
              .pipe(Effect.asVoid)
          ])
            expect((yield* Effect.flip(operation)).kind).toBe('not_found');
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
