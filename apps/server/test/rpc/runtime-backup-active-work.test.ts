/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Covers active feature authority and consumed proposal receipts across restore.     │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Retires pending generation, practice and grading dispatch without losing publications. │
 * │ - Preserves completed apply/keep receipts while rejecting new actions on old captures.   │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Uses public owners, native generation and a controlled provider; all SQLite guards stay. │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { randomUUID } from 'node:crypto';

import * as s from '@study/db/schema';
import { testStable } from '@study/testing/vitest';
import { Effect } from 'effect';
import { expect } from 'vite-plus/test';
import { assert } from 'vite-plus/test';

import { Conversations } from '#server/features/conversations/index';
import { Documents } from '#server/features/documents/index';
import { Learning } from '#server/features/learning/index';
import { Materials } from '#server/features/materials/index';
import { Projects } from '#server/features/projects/index';
import { Sources } from '#server/features/sources/index';
import { documentTransformFixture } from '#testing/document-transform';
import {
  backupFixture,
  createDocument,
  document as backupDocument,
  exportSnapshot,
  restoreSnapshot
} from '#testing/managed-backups';
import { processSource } from '#testing/material-history';
import { validDocumentTransformOutput } from '#testing/session-deletion';

for (const action of ['apply', 'keep'] as const)
  testStable(
    `completed proposal ${action} receipt replays after restore while a new key cannot act on its retired capture`,
    async () => {
      const source = await documentTransformFixture();

      let target: Awaited<ReturnType<typeof restoreSnapshot>> | undefined;

      try {
        const saved = await Effect.runPromise(
          Effect.gen(function* () {
            const m = yield* Documents;

            const c = yield* Conversations;

            const document = yield* m.create({
              createKey: randomUUID(),
              inputs: [],
              citations: [],
              title: 'Target',
              document: backupDocument('Target body')
            });

            assert.ok(document.version);
            const session = yield* c.createUntitledSession({});

            yield* m.attach({ sessionId: session.id, documentId: document.id });

            yield* c.updateSessionSelection({
              sessionId: session.id,
              expectedRevision: 0n,
              targets: [
                {
                  input: { kind: 'document', versionId: document.version.id },
                  scope: { kind: 'document' }
                }
              ]
            });

            const capture = yield* c.captureSessionContext({
              sessionId: session.id,
              intentKey: 'proposal',
              instruction: '',
              preferences: {}
            });

            const request = yield* c.requestDocumentTransform({
              contextRequestId: capture.requestId,
              title: 'Proposal',
              operations: ['clarity'],
              editTargetVersionId: document.version.id
            });

            return { document: { ...document, version: document.version }, capture, request };
          }).pipe(Effect.provide(source.domain()))
        );

        source.replies.push(
          { kind: 'sources', query: 'Target body' },
          {
            kind: 'output',
            output: validDocumentTransformOutput('Completed proposal [1]')
          }
        );

        const proposed = await source.executeAuthored(
          source.authoredEvent(saved.request.id),
          `backup-proposal-${action}`
        );

        const input = {
          requestId: saved.request.id,
          key: 'consumed-proposal',
          title: 'Independent kept copy',
          expectedVersionId: saved.document.version.id
        };

        const outcome = await Effect.runPromise(
          Effect.flatMap(Conversations, (c) =>
            action === 'apply' ? c.applyDocumentProposal(input) : c.keepDocumentProposal(input)
          ).pipe(Effect.provide(source.domain()))
        );

        assert.ok(outcome.resultVersionId !== null);

        const bytes = await exportSnapshot(source.context.db);

        await source.close();
        target = await restoreSnapshot(bytes);

        const app = target.app;

        const c = await app.nativeRuntime.runPromise(Conversations);

        const m = await app.nativeRuntime.runPromise(Documents);

        const replay = await app.nativeRuntime.runPromise(
          action === 'apply' ? c.applyDocumentProposal(input) : c.keepDocumentProposal(input)
        );

        expect(replay).toStrictEqual({ ...outcome, replayed: true });
        assert.strictEqual(
          (await app.nativeRuntime.runPromise(m.version({ id: outcome.resultVersionId }))).id,
          outcome.resultVersionId
        );
        assert.strictEqual(
          (await app.nativeRuntime.runPromise(m.version({ id: proposed }))).id,
          proposed
        );
        expect(
          await app.nativeRuntime.runPromise(
            c.inspectSessionContext({ requestId: saved.capture.requestId })
          )
        ).toStrictEqual(saved.capture);

        const late = { ...input, key: 'new-action' };

        assert.ok(
          (
            await app.nativeRuntime.runPromise(
              Effect.flip(
                action === 'apply' ? c.applyDocumentProposal(late) : c.keepDocumentProposal(late)
              )
            )
          ).kind === 'not_found'
        );

        const before = app.store.db.orm.select().from(s.study_document_versions).all();

        await app.workers.start();
        await app.workers.stop();
        expect(app.store.db.orm.select().from(s.study_document_versions).all()).toStrictEqual(
          before
        );
      } finally {
        await target?.close();
        await source.close();
      }
    }
  );

testStable(
  'pending generation, practice and open-answer grading do not dispatch after import',
  async () => {
    const source = await backupFixture();

    let target: Awaited<ReturnType<typeof restoreSnapshot>> | undefined;

    try {
      const document = await createDocument(source.app);

      const saved = await source.app.nativeRuntime.runPromise(
        Effect.gen(function* () {
          const projects = yield* Projects;

          const m = yield* Materials;

          const learning = yield* Learning;

          const project = yield* projects.createProject({ name: 'Practice backup' });

          yield* (yield* Documents).attachProject({
            projectId: project.id,
            documentId: document.id
          });

          const generation = yield* m.requestMaterialGeneration({
            projectId: project.id,
            kind: 'flashcards',
            title: 'Pending aid',
            inputs: [{ kind: 'document', versionId: document.version.id }]
          });

          const practice = yield* learning.startPractice({
            projectId: project.id,
            inputs: [{ kind: 'document', versionId: document.version.id }]
          });

          const quiz = yield* m.create({
            title: 'Independent quiz',
            publish: true,
            content: {
              kind: 'quiz',
              questions: [
                {
                  kind: 'open',
                  prompt: 'Why?',
                  explanation: 'Retained explanation',
                  referenceAnswer: 'Because'
                }
              ]
            }
          });

          const attempt = yield* learning.startQuiz({ versionId: quiz.version.id });

          const question = source.app.store.db.orm.select().from(s.material_quiz_questions).get();

          assert.ok(question);
          yield* learning.answerQuestion({
            attemptId: attempt.id,
            questionId: question.id,
            answer: { type: 'open', answer: 'Retained user answer' }
          });

          return { generation, practice, project, quiz, attempt };
        })
      );

      const attempts = source.app.store.db.orm.select().from(s.material_quiz_responses).all();

      const bytes = await exportSnapshot(source.app.store.db);

      await source.suspend();
      target = await restoreSnapshot(bytes);

      const app = target.app;

      const m = await app.nativeRuntime.runPromise(Materials);

      const generation = await app.nativeRuntime.runPromise(
        m.materialGeneration({ requestId: saved.generation.id, verifyOnly: true })
      );

      assert.ok(generation.cancelled === true);
      assert.ok(generation.resultVersionId === null);

      const learning = await app.nativeRuntime.runPromise(Learning);

      assert.ok(
        (await app.nativeRuntime.runPromise(learning.practice({ projectId: saved.project.id })))
          .enabled === false
      );
      assert.ok(
        app.store.db.orm
          .select()
          .from(s.learning_practice_slots)
          .all()
          .every((slot) => slot.status === 'cancelled')
      );
      expect(app.store.db.orm.select().from(s.material_quiz_responses).all()).toStrictEqual(
        attempts
      );
      assert.strictEqual(
        (await app.nativeRuntime.runPromise(m.materialVersion({ id: saved.quiz.version.id }))).id,
        saved.quiz.version.id
      );
      await app.workers.start();
      await app.workers.stop();
      assert.strictEqual(app.store.db.orm.select().from(s.workflow_executions).all().length, 0);
      expect(target.requests).toStrictEqual([]);
      expect(app.store.db.orm.select().from(s.material_quiz_responses).all()).toStrictEqual(
        attempts
      );

      const fresh = await app.nativeRuntime.runPromise(
        learning.startPractice({
          projectId: saved.project.id,
          inputs: [{ kind: 'document', versionId: document.version.id }]
        })
      );

      assert.ok(fresh.enabled === true);
      assert.notStrictEqual(fresh.epoch, saved.practice.epoch);
    } finally {
      await target?.close();
      await source.close();
    }
  }
);

testStable(
  'pending source correction retains completed extraction but cannot replay from the imported outbox',
  async () => {
    const source = await documentTransformFixture();

    let target: Awaited<ReturnType<typeof restoreSnapshot>> | undefined;

    try {
      const original = await Effect.runPromise(
        Effect.flatMap(Sources, (sources) =>
          sources.createSource({
            name: 'correct.txt',
            bytes: Buffer.from('Completed extraction'),
            projectId: null
          })
        ).pipe(Effect.provide(source.domain()))
      );

      const completed = await processSource(source);

      await Effect.runPromise(
        Effect.gen(function* () {
          const sources = yield* Sources;

          const before = yield* sources.sourceDocument(original.id);

          yield* sources.correctBlock({
            id: original.id,
            documentId: before.id,
            ordinal: 0,
            before: before.document.blocks[0]!.text,
            after: 'Pending correction'
          });
        }).pipe(Effect.provide(source.domain()))
      );

      const bytes = await exportSnapshot(source.context.db);

      await source.close();
      target = await restoreSnapshot(bytes);

      const app = target.app;

      const before = app.store.db.orm.select().from(s.content_snapshots).all();

      assert.ok(before.some((row) => row.id === completed.documentId));
      await app.workers.start();
      await app.workers.stop();
      expect(app.store.db.orm.select().from(s.content_snapshots).all()).toStrictEqual(before);
      expect(target.requests).toStrictEqual([]);
      assert.ok(
        app.store.db.orm
          .select()
          .from(s.workflow_executions)
          .all()
          .every((run) => run.status === 'completed' || run.status === 'cancelled')
      );
      assert.ok(app.store.db.orm.select().from(s.workflow_activities).all().length === 0);
    } finally {
      await target?.close();
      await source.close();
    }
  }
);
