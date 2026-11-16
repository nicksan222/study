import { noteQuestionRequestedSchema } from '@study/contracts';
/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Exercises durable question classifier recovery and publication ownership fences.   │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Checks persisted event recovery and generation checkpoint replay.                      │
 * │ - Checks automatic answer opt out and obsolete version retirement.                       │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Tests use migrated SQLite and typed model fixtures with isolated real workflow           │
 * │ services.                                                                                │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */
import { defaultAgentRules } from '@study/contracts';
import { workflowEvents } from '@study/db';
import { test } from '@study/testing';
import { Effect, Layer, Schema } from 'effect';
import type { Context } from 'effect';
import { WorkflowEngine } from 'effect/workflow';

import { questionAgent } from '#server/features/notes/agents/question';
import { Notes } from '#server/features/notes/index';
import { Settings } from '#server/features/settings/index';
import { layer as agentsLayer } from '#server/platform/ai/agents';
import { ServerContext } from '#server/platform/database/context';
import { Database } from '#server/platform/database/database';
import { normalizeError } from '#server/platform/errors/classify-error';
import { WorkflowConfiguration } from '#server/platform/workflows/configuration';
import { workflowEngineLayer } from '#server/platform/workflows/engine';
import { decodeEvent } from '#server/platform/workflows/events';
import { workflowDefinitions, workflowTriggers } from '#server/runtime/workflows';
import { withTestAdmission } from '#testing/workflow-admission';

import { noteQuestionHandler, noteQuestionWorkflow } from './question.ts';

test.stable(
  'classifier resumes persisted events and checkpoints generation; opt-out and obsolete work are safe',
  async ({ databases, createAiMock, expect, assert: assertions }) => {
    const assert: test.Assert = assertions;

    const location = await databases();
    let context = new ServerContext(await location.open());
    let calls = 0;
    using mock = createAiMock();
    const domain = () =>
      Layer.merge(Notes.layer, Settings.layer).pipe(
        Layer.provideMerge(Layer.succeed(Database, { store: context }))
      );
    const services = ({ expect }: Pick<test.Context, 'expect'>) =>
      Layer.mergeAll(
        domain(),
        agentsLayer({
          model: (tier, call) => {
            expect(tier).toBe('tiny');

            calls++;

            return mock.runtime.model(tier, call).pipe(Effect.mapError(normalizeError));
          },
          language: 'english',
          rules: Effect.succeed(defaultAgentRules),
          searchSources: () => Effect.succeed([])
        }),
        workflowEngineLayer(context),
        Layer.succeed(WorkflowConfiguration, { revision: Effect.succeed('test') })
      );
    const run = <A, E>(
      effect: Effect.Effect<
        A,
        E,
        | Context.Service.Identifier<typeof Notes>
        | Context.Service.Identifier<typeof Settings>
        | Database
      >
    ) => Effect.runPromise(effect.pipe(Effect.provide(domain())));
    const make = () =>
      run(
        Effect.gen(function* () {
          const c = yield* Notes;
          const note = yield* c.createNote({ title: 'Question' });

          return yield* c.postMessage({
            noteId: note.id,
            text: 'Why do stars shine?',
            requestReply: false
          });
        })
      );
    const eventFor = (id: Awaited<ReturnType<typeof make>>['id']) =>
      context.db.orm
        .select()
        .from(workflowEvents)
        .all()
        .map((e) => decodeEvent(e.payload))
        .find((e) => e.type === 'NoteQuestionRequested' && e.messageId === id);
    const execute = ({ expect }: Pick<test.Context, 'expect'>, raw: unknown, id: string) =>
      Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const event = Schema.decodeUnknownSync(noteQuestionRequestedSchema)(raw);
            const engine = yield* WorkflowEngine.WorkflowEngine;

            yield* engine.register(noteQuestionWorkflow, noteQuestionHandler);
            yield* withTestAdmission(
              context,
              noteQuestionWorkflow,
              id,
              { event },
              engine.execute(noteQuestionWorkflow, {
                executionId: id,
                payload: { event }
              })
            );
          }).pipe(Effect.provide(services({ expect })))
        )
      );

    try {
      expect(workflowDefinitions.some((d) => d.name === noteQuestionWorkflow.name)).toBe(true);
      expect(workflowTriggers.some((t) => t.event === 'NoteQuestionRequested')).toBe(true);
      const note = await make();
      const persisted = eventFor(note.id);

      assert.ok(persisted);
      context.close();
      context = new ServerContext(await location.open());
      mock.next(questionAgent, {
        input: { text: 'Why do stars shine?' },
        output: { kind: 'question' }
      });
      await execute({ expect }, eventFor(note.id), 'question-recovered');
      expect(calls).toBe(1);
      await execute({ expect }, eventFor(note.id), 'question-recovered');
      expect(calls).toBe(1);
      const read = await run(Effect.flatMap(Notes, (c) => c.message(note.id)));

      expect(read.question?.kind).toBe('question');
      expect(read.question?.answerMessageId).toBeUndefined();
      await run(
        Effect.flatMap(Settings, (s) =>
          Effect.flatMap(s.workspacePreferences(), (p) =>
            s.saveWorkspacePreferences({ ...p, autoAnswerQuestions: true })
          )
        )
      );
      const optout = await make();

      const optoutPlan = mock.next(questionAgent, {
        input: { text: 'Why do stars shine?' },
        output: { kind: 'question' },
        hold: true
      });
      const optoutExecution = execute({ expect }, eventFor(optout.id), 'question-optout');

      await optoutPlan.called;
      await run(
        Effect.flatMap(Settings, (s) =>
          Effect.flatMap(s.workspacePreferences(), (p) =>
            s.saveWorkspacePreferences({ ...p, autoAnswerQuestions: false })
          )
        )
      );
      optoutPlan.release();
      await optoutExecution;
      expect(
        (await run(Effect.flatMap(Notes, (c) => c.message(optout.id)))).question?.answerMessageId
      ).toBeUndefined();
      const stale = await make();

      await run(
        Effect.flatMap(Notes, (c) =>
          c.editMessage({
            messageId: stale.id,
            expectedActiveVersionId: stale.activeVersionId!,
            text: 'A later revision'
          })
        )
      );
      const before = calls;

      await execute({ expect }, eventFor(stale.id), 'question-stale');
      expect(calls).toBe(before);
      await run(
        Effect.flatMap(Settings, (s) =>
          Effect.flatMap(s.workspacePreferences(), (p) =>
            s.saveWorkspacePreferences({ ...p, autoAnswerQuestions: true })
          )
        )
      );
      const manual = await make();

      await run(
        Effect.flatMap(Notes, (c) =>
          c.setMessageKind({
            messageId: manual.id,
            expectedActiveVersionId: manual.activeVersionId!,
            kind: 'question'
          })
        )
      );
      const followup = context.db.orm
        .select()
        .from(workflowEvents)
        .all()
        .map((e) => decodeEvent(e.payload))
        .findLast((e) => e.type === 'NoteQuestionRequested' && e.messageId === manual.id);

      assert.ok(followup);
      context.close();
      context = new ServerContext(await location.open());
      const beforeManual = calls;

      await execute({ expect }, followup, 'manual-question-recovered');
      expect(calls).toBe(beforeManual);
      const answered = await run(Effect.flatMap(Notes, (c) => c.message(manual.id)));

      expect(answered.question?.answerMessageId).toBeDefined();
      await execute({ expect }, followup, 'manual-question-recovered');
      expect(
        (await run(Effect.flatMap(Notes, (c) => c.message(manual.id)))).question?.answerMessageId
      ).toBe(answered.question?.answerMessageId);
    } finally {
      context.close();
      await location.cleanup();
    }
  }
);
