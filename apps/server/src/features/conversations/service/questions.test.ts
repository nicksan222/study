/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Exercises persisted question classification and targeted answer request behavior.  │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Checks stale versions, manual overrides and concurrent answer deduplication.           │
 * │ - Checks explicit requests, version restoration and terminal retry recovery.             │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Tests use migrated temporary SQLite databases and public conversation service            │
 * │ operations.                                                                              │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { workflowEvents, workflow_executions } from '@study/db/schema';
import { createTestDatabase } from '@study/db/testing';
import { testStable } from '@study/testing/vitest';
import { Effect, Layer } from 'effect';
import { expect } from 'vite-plus/test';

import { Conversations } from '#server/features/conversations/index';
import { Settings } from '#server/features/settings/index';
import { Sources } from '#server/features/sources/index';
import { ServerContext } from '#server/platform/database/context';
import { Database } from '#server/platform/database/database';
import { decodeEvent } from '#server/platform/workflows/events';
import { withTestPublication } from '#testing/publication';

testStable.each([1, 2] as const)(
  'marking a question starts one answer version and publishes question and answer in place in language %s',
  async (language) => {
    const location = createTestDatabase();
    const context = new ServerContext(location.open());

    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const c = yield* Conversations;
          const settings = yield* Settings;

          yield* settings.saveAppSettings({ ...(yield* settings.appSettings()), language });
          const session = yield* c.createSession({ title: 'Question and answer' });
          const original = yield* c.postMessage({
            sessionId: session.id,
            text: 'Why does ice float?',
            requestReply: false
          });
          const input = {
            messageId: original.id,
            expectedActiveVersionId: original.activeVersionId!
          };
          const marked = yield* c.setMessageKind({ ...input, kind: 'question' });

          expect(marked.versions).toHaveLength(2);
          expect(marked.question?.answerMessageId).toBe(original.id);
          const answer = yield* c.answerQuestion(input);

          expect(answer.messageId).toBe(original.id);
          expect(answer.versionId).not.toBe(original.activeVersionId);
          expect(marked.versions.at(-1)).toMatchObject({
            id: answer.versionId,
            origin: 'answer',
            status: 'pending',
            basedOn: original.activeVersionId,
            text: ''
          });
          expect(yield* c.answerQuestion(input)).toEqual(answer);
          const publication = {
            requestId: answer.requestId,
            text: 'Ice is less dense than liquid water.',
            citations: []
          };

          yield* withTestPublication(context, c.publishReply(publication));
          yield* settings.saveAppSettings({
            ...(yield* settings.appSettings()),
            language: language === 1 ? 2 : 1
          });
          yield* withTestPublication(context, c.publishReply(publication));
          const completed = yield* c.message(original.id);

          expect(completed.activeVersionId).toBe(answer.versionId);
          expect(completed.versions).toHaveLength(2);
          expect(completed.versions[0]?.text).toBe('Why does ice float?');
          expect(completed.versions.at(-1)?.text).toBe(
            language === 1
              ? '**Question**\n\nWhy does ice float?\n\n**Answer**\n\nIce is less dense than liquid water.'
              : '**Domanda**\n\nWhy does ice float?\n\n**Risposta**\n\nIce is less dense than liquid water.'
          );
          expect((yield* c.thread({ sessionId: session.id, limit: 30 })).items).toHaveLength(1);
          expect(yield* c.answerQuestion(input)).toEqual(answer);
          yield* c.setActiveVersion({
            messageId: original.id,
            versionId: original.activeVersionId!
          });
          yield* c.setActiveVersion({ messageId: original.id, versionId: answer.versionId });
          expect((yield* c.message(original.id)).question?.answerVersionId).toBe(answer.versionId);
        }).pipe(
          Effect.provide(Layer.merge(Conversations.layer, Settings.layer)),
          Effect.provide(Layer.succeed(Database, { store: context }))
        )
      );
    } finally {
      context.close();
      location.cleanup();
    }
  }
);

testStable(
  'abandoning an in-place answer preserves the question and permits a fresh answer',
  async () => {
    const location = createTestDatabase();
    const context = new ServerContext(location.open());

    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const c = yield* Conversations;
          const session = yield* c.createSession({ title: 'Recovery' });
          const note = yield* c.postMessage({
            sessionId: session.id,
            text: 'Why?',
            requestReply: false
          });
          const input = { messageId: note.id, expectedActiveVersionId: note.activeVersionId! };

          yield* c.setMessageKind({ ...input, kind: 'question' });
          const answer = yield* c.answerQuestion(input);

          yield* withTestPublication(context, c.abandonReply(answer));
          const restored = yield* c.message(note.id);

          expect(restored.versions).toHaveLength(1);
          expect(restored.activeVersionId).toBe(note.activeVersionId);
          expect(restored.question?.answerVersionId).toBeUndefined();
          const retried = yield* c.answerQuestion(input);

          expect(retried.messageId).toBe(note.id);
          expect(retried.requestId).not.toBe(answer.requestId);
          expect((yield* c.message(note.id)).versions).toHaveLength(2);
        }).pipe(
          Effect.provide(Conversations.layer),
          Effect.provide(Layer.succeed(Database, { store: context }))
        )
      );
    } finally {
      context.close();
      location.cleanup();
    }
  }
);

testStable('question answers capture their exact target and deduplicate per version', async () => {
  const location = createTestDatabase();
  const context = new ServerContext(location.open());

  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const c = yield* Conversations;
        const session = yield* c.createSession({ title: 'Questions' });
        const question = yield* c.postMessage({
          sessionId: session.id,
          text: 'Why does ice float?',
          requestReply: false
        });
        const input = {
          messageId: question.id,
          expectedActiveVersionId: question.activeVersionId!
        };

        yield* c.setMessageKind({ ...input, kind: 'question' });
        const later = yield* c.postMessage({
          sessionId: session.id,
          text: 'Later unrelated note',
          requestReply: false
        });
        const answer = yield* c.answerQuestion(input);

        expect(yield* c.answerQuestion(input)).toEqual(answer);
        expect(answer.messageId).toBe(question.id);
        const snapshot = yield* c.replySnapshot({ requestId: answer.requestId });

        expect(snapshot.messages.at(-1)?.messageId).toBe(question.id);
        expect(snapshot.messages.some((m) => m.messageId === later.id)).toBe(false);

        context.db.orm
          .insert(workflow_executions)
          .values({
            execution_id: 'cancelled-answer',
            workflow_tag: 'conversation-reply',
            version: 1,
            payload: JSON.stringify({ event: { correlationId: answer.requestId } }),
            status: 'cancelled',
            created_at: 1n,
            updated_at: 1n
          })
          .run();
        const retried = yield* c.answerQuestion(input);

        expect(retried.requestId).not.toBe(answer.requestId);
        expect(retried.messageId).toBe(question.id);
        expect((yield* c.message(question.id)).question?.answerRequestId).toBe(retried.requestId);
        expect(yield* c.answerQuestion(input)).toEqual(retried);
        const edited = yield* c.editMessage({ ...input, text: 'Why does wood float?' });

        expect(edited.question?.origin).toBe('manual');
        expect(edited.question?.versionId).toBe(edited.activeVersionId);
        expect((yield* Effect.result(c.answerQuestion(input)))._tag).toBe('Failure');
      }).pipe(
        Effect.provide(Conversations.layer),
        Effect.provide(Layer.succeed(Database, { store: context }))
      )
    );
  } finally {
    context.close();
    location.cleanup();
  }
});

testStable(
  'classification persists, fences stale work and preserves manual overrides',
  async () => {
    const location = createTestDatabase();
    let context = new ServerContext(location.open());

    const run = <A, E>(effect: Effect.Effect<A, E, Database>) =>
      Effect.runPromise(effect.pipe(Effect.provide(Layer.succeed(Database, { store: context }))));

    try {
      const saved = await run(
        Effect.gen(function* () {
          const c = yield* Conversations;
          const settings = yield* Settings;

          expect((yield* settings.workspacePreferences()).autoAnswerQuestions).toBe(false);
          const session = yield* c.createSession({ title: 'Classification' });
          const note = yield* c.postMessage({
            sessionId: session.id,
            text: 'I wonder how gravity works',
            requestReply: false
          });
          const input = { messageId: note.id, expectedActiveVersionId: note.activeVersionId! };

          yield* withTestPublication(context, c.publishQuestion({ ...input, kind: 'question' }));
          expect((yield* c.message(note.id)).question).toEqual({
            kind: 'question',
            origin: 'automatic',
            versionId: note.activeVersionId,
            answerMessageId: undefined,
            answerArchived: false
          });
          const selectedAgain = yield* c.setActiveVersion({
            messageId: note.id,
            versionId: note.activeVersionId!
          });

          expect(selectedAgain.question?.kind).toBe('question');
          const edited = yield* c.editMessage({ ...input, text: 'A statement' });

          expect(edited.question).toBeUndefined();
          const beforeRestore = context.db.orm.select().from(workflowEvents).all().length;

          yield* c.setActiveVersion({ messageId: note.id, versionId: note.activeVersionId! });
          expect(context.db.orm.select().from(workflowEvents).all().length).toBe(beforeRestore + 1);
          yield* withTestPublication(context, c.publishQuestion({ ...input, kind: 'question' }));
          expect((yield* c.message(note.id)).question?.kind).toBe('question');
          yield* c.setActiveVersion({ messageId: note.id, versionId: edited.activeVersionId! });

          expect(
            (yield* Effect.result(
              withTestPublication(context, c.publishQuestion({ ...input, kind: 'question' }))
            ))._tag
          ).toBe('Failure');
          const next = { messageId: note.id, expectedActiveVersionId: edited.activeVersionId! };

          yield* c.setMessageKind({ ...next, kind: 'note' });
          yield* withTestPublication(context, c.publishQuestion({ ...next, kind: 'question' }));
          expect((yield* c.message(note.id)).question?.kind).toBe('note');
          yield* c.setItemArchived({
            sessionId: session.id,
            target: { kind: 'message', id: note.id },
            archived: true
          });
          expect((yield* Effect.result(c.answerQuestion(next)))._tag).toBe('Failure');
          expect((yield* Effect.result(c.questionSnapshot(next)))._tag).toBe('Failure');

          return { id: note.id };
        }).pipe(Effect.provide(Layer.merge(Conversations.layer, Settings.layer)))
      );

      context.close();
      context = new ServerContext(location.open());
      const read = await run(
        Effect.flatMap(Conversations, (c) => c.message(saved.id)).pipe(
          Effect.provide(Conversations.layer)
        )
      );

      expect(read.question?.origin).toBe('manual');
    } finally {
      context.close();
      location.cleanup();
    }
  }
);

testStable(
  'automatic and manual answers share one durable receipt; archive and override fence generation',
  async () => {
    const location = createTestDatabase();
    const context = new ServerContext(location.open());

    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const c = yield* Conversations;
          const settings = yield* Settings;
          const defaults = yield* settings.workspacePreferences();

          yield* settings.saveWorkspacePreferences({ ...defaults, autoAnswerQuestions: true });
          const session = yield* c.createSession({ title: 'Automatic' });
          const note = yield* c.postMessage({
            sessionId: session.id,
            text: 'Explain buoyancy',
            requestReply: false
          });
          const input = { messageId: note.id, expectedActiveVersionId: note.activeVersionId! };

          yield* withTestPublication(context, c.publishQuestion({ ...input, kind: 'question' }));
          const answers = yield* Effect.all([c.answerQuestion(input), c.answerQuestion(input)], {
            concurrency: 'unbounded'
          });

          expect(answers[0]).toEqual(answers[1]);
          expect((yield* c.message(note.id)).question?.answerMessageId).toBe(answers[0]!.messageId);

          const another = yield* c.postMessage({
            sessionId: session.id,
            text: 'Why do boats float?',
            requestReply: false
          });

          yield* withTestPublication(
            context,
            c.publishQuestion({
              messageId: another.id,
              expectedActiveVersionId: another.activeVersionId!,
              kind: 'question'
            })
          );
          expect((yield* c.message(another.id)).question?.answerMessageId).toBeDefined();
          expect((yield* c.message(note.id)).question?.answerMessageId).toBe(answers[0]!.messageId);
          yield* c.setMessageKind({ ...input, kind: 'note' });
          expect(
            (yield* Effect.result(c.replySnapshot({ requestId: answers[0]!.requestId })))._tag
          ).toBe('Failure');
          const document = yield* c.postMessage({
            sessionId: session.id,
            text: 'Why?',
            format: 'document',
            requestReply: false
          });

          expect(
            (yield* Effect.result(
              c.questionSnapshot({
                messageId: document.id,
                expectedActiveVersionId: document.activeVersionId!
              })
            ))._tag
          ).toBe('Failure');
          yield* c.deleteMessage(note.id);
          expect((yield* Effect.result(c.questionSnapshot(input)))._tag).toBe('Failure');
        }).pipe(
          Effect.provide(Layer.merge(Conversations.layer, Settings.layer)),
          Effect.provide(Layer.succeed(Database, { store: context }))
        )
      );
    } finally {
      context.close();
      location.cleanup();
    }
  }
);

testStable('explicit Ask and requested replies are reused by automatic answering', async () => {
  const location = createTestDatabase();
  const context = new ServerContext(location.open());

  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const c = yield* Conversations;
        const settings = yield* Settings;

        yield* settings.saveWorkspacePreferences({
          ...(yield* settings.workspacePreferences()),
          autoAnswerQuestions: true
        });
        const session = yield* c.createSession({ title: 'Explicit' });
        const asked = yield* c.ask({
          sessionId: session.id,
          intentKey: 'explicit-ask',
          expectedSelectionRevision: 0n,
          text: 'Why does ice float?'
        });

        yield* c.replySnapshot({ requestId: asked.requestId });
        const input = {
          messageId: asked.userMessageId,
          expectedActiveVersionId: asked.userVersionId
        };

        yield* withTestPublication(context, c.publishQuestion({ ...input, kind: 'question' }));
        expect((yield* c.answerQuestion(input)).requestId).toBe(asked.requestId);
        const secondSession = yield* c.createSession({ title: 'Requested' });
        const requested = yield* c.postMessage({
          sessionId: secondSession.id,
          text: 'Why is the sky blue?',
          requestReply: true
        });
        const latest = context.db.orm
          .select()
          .from(workflowEvents)
          .all()
          .map((e) => decodeEvent(e.payload))
          .filter((e) => e.type === 'ConversationGenerationRequested')
          .at(-1)!;

        if (latest.type !== 'ConversationGenerationRequested') throw Error('missing generation');

        yield* c.replySnapshot({ requestId: latest.requestId });
        const next = {
          messageId: requested.id,
          expectedActiveVersionId: requested.activeVersionId!
        };

        yield* withTestPublication(context, c.publishQuestion({ ...next, kind: 'question' }));
        expect((yield* c.answerQuestion(next)).requestId).toBe(latest.requestId);
        const thirdSession = yield* c.createSession({ title: 'Separate request' });
        const saved = yield* c.postMessage({
          sessionId: thirdSession.id,
          text: 'Why is water wet?',
          requestReply: false
        });
        const direct = yield* c.requestReply({ sessionId: thirdSession.id });
        const savedInput = { messageId: saved.id, expectedActiveVersionId: saved.activeVersionId! };

        yield* withTestPublication(context, c.publishQuestion({ ...savedInput, kind: 'question' }));
        expect((yield* c.answerQuestion(savedInput)).requestId).toBe(direct.requestId);
      }).pipe(
        Effect.provide(Layer.merge(Conversations.layer, Settings.layer)),
        Effect.provide(Layer.succeed(Database, { store: context }))
      )
    );
  } finally {
    context.close();
    location.cleanup();
  }
});

testStable(
  'empty attachment captures and inactive-version deletion do not schedule classification',
  async () => {
    const location = createTestDatabase();
    const context = new ServerContext(location.open());

    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const c = yield* Conversations;
          const sources = yield* Sources;
          const session = yield* c.createSession({ title: 'Scheduling' });
          const source = yield* sources.createSource({
            name: 'Notes.txt',
            bytes: new TextEncoder().encode('Material'),
            projectId: null
          });

          yield* c.postMessage({
            sessionId: session.id,
            text: '  ',
            sourceIds: [source.id],
            requestReply: false
          });
          expect(
            context.db.orm
              .select()
              .from(workflowEvents)
              .all()
              .filter((e) => e.type === 'ConversationQuestionRequested')
          ).toHaveLength(0);
          const first = yield* c.postMessage({
            sessionId: session.id,
            text: 'First note',
            requestReply: false
          });
          const edited = yield* c.editMessage({
            messageId: first.id,
            text: 'Why does this happen?'
          });
          const input = { messageId: first.id, expectedActiveVersionId: edited.activeVersionId! };

          yield* withTestPublication(context, c.publishQuestion({ ...input, kind: 'question' }));
          const before = context.db.orm.select().from(workflowEvents).all().length;
          const remaining = yield* c.deleteMessageVersion({
            messageId: first.id,
            versionId: first.activeVersionId!
          });

          expect(remaining.question?.kind).toBe('question');
          expect(context.db.orm.select().from(workflowEvents).all()).toHaveLength(before);
        }).pipe(
          Effect.provide(Layer.merge(Conversations.layer, Sources.layer)),
          Effect.provide(Layer.succeed(Database, { store: context }))
        )
      );
    } finally {
      context.close();
      location.cleanup();
    }
  }
);

testStable(
  'deleting a question cascades its pending answer and fences late publication',
  async () => {
    const location = createTestDatabase();
    const context = new ServerContext(location.open());

    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const c = yield* Conversations;
          const session = yield* c.createSession({ title: 'Deletion' });
          const question = yield* c.postMessage({
            sessionId: session.id,
            text: 'Why does ice float?',
            requestReply: false
          });
          const input = {
            messageId: question.id,
            expectedActiveVersionId: question.activeVersionId!
          };

          yield* c.setMessageKind({ ...input, kind: 'question' });
          const answer = yield* c.answerQuestion(input);

          yield* c.replySnapshot({ requestId: answer.requestId });
          yield* c.deleteMessage(question.id);
          expect((yield* Effect.result(c.message(answer.messageId)))._tag).toBe('Failure');
          expect(
            (yield* Effect.result(c.replySnapshot({ requestId: answer.requestId })))._tag
          ).toBe('Failure');
          expect(
            (yield* Effect.result(
              withTestPublication(
                context,
                c.publishReply({ requestId: answer.requestId, text: 'Late answer', citations: [] })
              )
            ))._tag
          ).toBe('Failure');
          expect((yield* c.thread({ sessionId: session.id, limit: 30 })).items).toHaveLength(0);
        }).pipe(
          Effect.provide(Conversations.layer),
          Effect.provide(Layer.succeed(Database, { store: context }))
        )
      );
    } finally {
      context.close();
      location.cleanup();
    }
  }
);

testStable(
  'unavailable evidence preserves automatic classification and rejects a manual answer atomically',
  async () => {
    const location = createTestDatabase();
    const context = new ServerContext(location.open());

    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const c = yield* Conversations;
          const sources = yield* Sources;
          const settings = yield* Settings;

          yield* settings.saveWorkspacePreferences({
            ...(yield* settings.workspacePreferences()),
            autoAnswerQuestions: true
          });
          const session = yield* c.createSession({ title: 'Unavailable context' });

          for (const manual of [false, true]) {
            const source = yield* sources.createSource({
              name: 'Evidence.txt',
              bytes: new TextEncoder().encode('Evidence'),
              projectId: null
            });
            const note = yield* c.postMessage({
              sessionId: session.id,
              text: 'What does the evidence show?',
              sourceIds: [source.id],
              requestReply: false
            });
            const input = { messageId: note.id, expectedActiveVersionId: note.activeVersionId! };

            yield* sources.deleteSource({ id: source.id });

            if (manual) {
              expect(
                (yield* Effect.result(c.setMessageKind({ ...input, kind: 'question' })))._tag
              ).toBe('Failure');
              const unchanged = yield* c.message(note.id);

              expect(unchanged.question).toBeUndefined();
              expect(unchanged.versions).toHaveLength(1);
              continue;
            }

            const attempted = yield* Effect.result(
              withTestPublication(context, c.publishQuestion({ ...input, kind: 'question' }))
            );

            expect(attempted._tag).toBe('Failure');
            expect((yield* c.message(note.id)).question?.kind).toBe('question');
            expect((yield* c.message(note.id)).question?.origin).toBe('automatic');
          }
        }).pipe(
          Effect.provide(Layer.mergeAll(Conversations.layer, Sources.layer, Settings.layer)),
          Effect.provide(Layer.succeed(Database, { store: context }))
        )
      );
    } finally {
      context.close();
      location.cleanup();
    }
  }
);
