import { defaultAgentRules } from '@study/contracts';
/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Verifies title workflow checkpointing and rejects stale context or notes           │
 * │ renamed before publication.                                                              │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Tests the workflow against stale snapshots and concurrent user title changes.          │
 * │ - Asserts durable effects against persisted state and replay behavior.                   │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ The suite drives the native workflow engine with persisted test state; it does not       │
 * │ replace production activities.                                                           │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */
import { defaultWorkspacePreferences } from '@study/contracts';
import * as s from '@study/db';
import { test } from '@study/testing';
import { Effect, Layer } from 'effect';
import type { Context } from 'effect';
import { WorkflowEngine } from 'effect/workflow';

import { titleAgent } from '#server/features/notes/agents/title';
import { Notes } from '#server/features/notes/service/index';
import { Settings } from '#server/features/settings/index';
import { layer as agentsLayer } from '#server/platform/ai/agents';
import { ServerContext } from '#server/platform/database/context';
import { Database } from '#server/platform/database/database';
import { normalizeError } from '#server/platform/errors/classify-error';
import { WorkflowConfiguration } from '#server/platform/workflows/configuration';
import { workflowEngineLayer } from '#server/platform/workflows/engine';
import { decodeEvent } from '#server/platform/workflows/events';
import { withTestPublication } from '#testing/publication';
import { withTestAdmission } from '#testing/workflow-admission';

import { noteTitleHandler, noteTitleWorkflow } from './title.ts';

test.server.stable(
  'title workflow checkpoints and fences stale and renamed notes',
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
    const services = () =>
      Layer.mergeAll(
        domain(),
        Layer.succeed(Database, { store: context }),
        Layer.succeed(WorkflowConfiguration, { revision: Effect.succeed('test') }),
        agentsLayer({
          model: (tier, call) => {
            calls++;

            return mock.runtime.model(tier, call).pipe(Effect.mapError(normalizeError));
          },
          language: Effect.succeed('en'),
          rules: Effect.succeed(defaultAgentRules),
          searchSources: () => Effect.succeed([])
        }),
        workflowEngineLayer(context)
      );
    const run = <A, E>(
      effect: Effect.Effect<
        A,
        E,
        | Database
        | Context.Service.Identifier<typeof Notes>
        | Context.Service.Identifier<typeof Settings>
      >
    ) => Effect.runPromise(effect.pipe(Effect.provide(domain())));

    try {
      const project = context.db.orm
        .insert(s.projects)
        .values({ name: 'P', created_at: 1n, updated_at: 1n })
        .returning()
        .get();
      const make = async () => {
        const note = await run(
          Effect.flatMap(Notes, (c) => c.createUntitledNote({ project: project.id }))
        );
        const message = await run(
          Effect.flatMap(Notes, (c) => c.postMessage({ noteId: note.id, text: 'Study cells' }))
        );

        return { note, message };
      };
      const request = async (
        { assert: assertions }: Pick<test.server.Context, 'assert'>,
        noteId: Awaited<ReturnType<typeof make>>['note']['id']
      ) => {
        const assert: test.Assert = assertions;

        await run(Effect.flatMap(Notes, (c) => c.requestTitle({ noteId })));
        const event = decodeEvent(
          context.db.orm.select().from(s.workflowEvents).all().at(-1)!.payload
        );

        assert.ok(!(event.type !== 'NoteTitleRequested'), 'wrong event');

        return event;
      };
      const execute = (event: Awaited<ReturnType<typeof request>>, id: string) =>
        Effect.runPromise(
          Effect.scoped(
            Effect.gen(function* () {
              const engine = yield* WorkflowEngine.WorkflowEngine;

              yield* engine.register(noteTitleWorkflow, noteTitleHandler);

              return yield* withTestAdmission(
                context,
                noteTitleWorkflow,
                id,
                { event },
                engine.execute(noteTitleWorkflow, {
                  executionId: id,
                  payload: { event }
                })
              );
            }).pipe(Effect.provide(services()))
          )
        );
      const plan = (event: Awaited<ReturnType<typeof request>>, output: string, hold = false) =>
        mock.next(titleAgent, {
          input: {
            prompt: JSON.stringify({
              title: event.title,
              messages: event.messages.map(({ role, text }) => ({ role, text }))
            })
          },
          output,
          hold
        });
      const first = await make();
      const stale = await request({ assert }, first.note.id);

      await run(
        Effect.flatMap(Notes, (c) => c.editMessage({ messageId: first.message.id, text: 'Plants' }))
      );
      await expect(execute(stale, 'stale-title')).rejects.toSatisfy(() => true);
      assert.strictEqual(calls, 0);
      const old = await request({ assert }, first.note.id);
      const current = await request({ assert }, first.note.id);

      await expect(execute(old, 'old-title')).rejects.toSatisfy(() => true);
      assert.strictEqual(calls, 0);
      const currentPlan = plan(current, 'Cell Biology');

      await execute(current, 'replay-title');
      assert.strictEqual(calls, 1);
      context.close();
      context = new ServerContext(await location.open());
      await execute(current, 'replay-title');
      assert.strictEqual(calls, 1);
      assert.ok(
        (await run(Effect.flatMap(Notes, (c) => c.note(first.note.id)))).title === 'Cell Biology'
      );
      await execute(current, 'replay-title');
      assert.strictEqual(calls, 1, 'a committed title must replay without a new model call');
      expect((await currentPlan.called).input.prompt).toContain('Plants');
      const renamed = await make();
      const renamedRequest = await request({ assert }, renamed.note.id);

      await run(
        Effect.flatMap(Notes, (c) => c.renameNote({ id: renamed.note.id, title: 'Personal' }))
      );
      await expect(execute(renamedRequest, 'renamed-title')).rejects.toSatisfy(() => true);
      assert.strictEqual(calls, 1);
      const race = await make();
      const racing = await request({ assert }, race.note.id);

      const racingPlan = plan(racing, 'Cell Biology', true);
      const raceExecution = execute(racing, 'race-title');
      const raceResult = raceExecution.then(
        () => false,
        () => true
      );

      await racingPlan.called;
      await run(Effect.flatMap(Notes, (c) => c.renameNote({ id: race.note.id, title: 'Mine' })));
      racingPlan.release();
      expect(await raceResult).toBe(true);
      assert.ok((await run(Effect.flatMap(Notes, (c) => c.note(race.note.id)))).title === 'Mine');
      const invalid = await make();

      const invalidRequest = await request({ assert }, invalid.note.id);

      plan(invalidRequest, 'x'.repeat(201));
      await expect(execute(invalidRequest, 'invalid-title')).rejects.toSatisfy(() => true);
      assert.ok(
        (await run(Effect.flatMap(Notes, (c) => c.note(invalid.note.id)))).titleSource ===
          'provisional'
      );
      const retryRequest = await request({ assert }, invalid.note.id);

      plan(retryRequest, 'Valid retry');
      await execute(retryRequest, 'retry-title');
      assert.ok(
        (await run(Effect.flatMap(Notes, (c) => c.note(invalid.note.id)))).title === 'Valid retry'
      );
      const mergeFirst = await make();
      const mergeSecond = await make();
      const merged = await run(
        Effect.flatMap(Notes, (c) =>
          c.mergeNotes({
            noteIds: [mergeFirst.note.id, mergeSecond.note.id],
            intentKey: 'title-merge'
          })
        )
      );
      const mergeEvent = decodeEvent(
        context.db.orm.select().from(s.workflowEvents).all().at(-1)!.payload
      );

      assert.ok(
        mergeEvent.type === 'NoteTitleRequested',
        'merge must queue the existing title workflow'
      );
      plan(mergeEvent, 'Combined Biology');
      await execute(mergeEvent, 'merged-title');
      expect((await run(Effect.flatMap(Notes, (c) => c.note(merged.id)))).title).toBe(
        'Combined Biology'
      );
      expect(
        (await run(Effect.flatMap(Notes, (c) => c.note(mergeFirst.note.id)))).archivedAt
      ).not.toBeNull();
    } finally {
      context.close();
      await location.cleanup();
    }
  }
);

test.server.stable(
  'explicit title requests replace existing titles and fence subsequent manual edits',
  async ({ databases, assert: assertions }) => {
    const assert: test.Assert = assertions;

    const location = await databases();
    const context = new ServerContext(await location.open());
    const layer = Notes.layer.pipe(Layer.provideMerge(Layer.succeed(Database, { store: context })));

    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const notes = yield* Notes;
          const note = yield* notes.createNote({ title: 'My biology notes' });

          yield* notes.postMessage({ noteId: note.id, text: 'Cells and tissues' });
          const first = yield* notes.requestTitle({ noteId: note.id });

          yield* withTestPublication(
            context,
            notes
              .publishTitle({ requestId: first.requestId, title: 'Cell biology' })
              .pipe(Effect.asVoid)
          );
          assert.strictEqual((yield* notes.note(note.id)).title, 'Cell biology');
          const second = yield* notes.requestTitle({ noteId: note.id });

          yield* withTestPublication(
            context,
            notes
              .publishTitle({ requestId: second.requestId, title: 'Tissues' })
              .pipe(Effect.asVoid)
          );
          assert.strictEqual((yield* notes.note(note.id)).title, 'Tissues');
          yield* notes.renameNote({ id: note.id, title: 'Personal' });
          const pending = yield* notes.requestTitle({ noteId: note.id });

          yield* notes.renameNote({ id: note.id, title: 'Personal' });
          assert.strictEqual(
            (yield* Effect.flip(notes.titleSnapshot({ requestId: pending.requestId }))).kind,
            'invalid_input'
          );
        }).pipe(Effect.provide(layer))
      );
    } finally {
      context.close();
      await location.cleanup();
    }
  }
);

test.server.stable(
  'automatic note titles are opt-in, durable, replay-safe and respect user titles',
  async ({ databases, assert: assertions }) => {
    const assert: test.Assert = assertions;

    const location = await databases();
    const context = new ServerContext(await location.open());
    const layer = Layer.merge(Notes.layer, Settings.layer).pipe(
      Layer.provideMerge(Layer.succeed(Database, { store: context }))
    );

    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const notes = yield* Notes;
          const settings = yield* Settings;
          const note = yield* notes.createUntitledNote({});

          yield* notes.postMessage({ noteId: note.id, text: 'Cells and tissues' });
          const titles = () =>
            context.db.orm
              .select()
              .from(s.workflowEvents)
              .all()
              .map((row) => decodeEvent(row.payload))
              .filter((event) => event.type === 'NoteTitleRequested');

          assert.strictEqual(titles().length, 0);
          yield* settings.saveWorkspacePreferences({
            ...defaultWorkspacePreferences,
            autoTitleNotes: true
          });
          const input = {
            noteId: note.id,
            text: 'Mitosis overview',
            captureKey: 'automatic-title-note',
            requestReply: false
          };
          const noteMessage = yield* notes.postMessage(input);

          assert.strictEqual(titles().length, 1);
          assert.strictEqual((yield* notes.postMessage(input)).id, noteMessage.id);
          assert.strictEqual(titles().length, 1);
          yield* notes.renameNote({ id: note.id, title: 'My biology notes' });
          yield* notes.postMessage({ noteId: note.id, text: 'More cells' });
          assert.strictEqual(titles().length, 1);
          yield* settings.saveWorkspacePreferences(defaultWorkspacePreferences);
          const manual = yield* notes.createUntitledNote({});

          yield* notes.postMessage({ noteId: manual.id, text: 'Manual title' });
          yield* notes.requestTitle({ noteId: manual.id });
          assert.strictEqual(titles().length, 2);
        }).pipe(Effect.provide(layer))
      );
    } finally {
      context.close();
      await location.cleanup();
    }
  }
);

test.server.stable(
  'automatic titles and replies commit together while title snapshots skip pending assistants',
  async ({ databases, assert: assertions, expect }) => {
    const assert: test.Assert = assertions;

    const location = await databases();
    const context = new ServerContext(await location.open());
    const layer = Layer.merge(Notes.layer, Settings.layer).pipe(
      Layer.provideMerge(Layer.succeed(Database, { store: context }))
    );

    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const notes = yield* Notes;
          const settings = yield* Settings;

          yield* settings.saveWorkspacePreferences({
            ...defaultWorkspacePreferences,
            autoTitleNotes: true
          });
          const note = yield* notes.createUntitledNote({});
          const noteMessage = yield* notes.postMessage({
            noteId: note.id,
            text: 'Explain cell division',
            requestReply: true
          });
          const events = context.db.orm
            .select()
            .from(s.workflowEvents)
            .all()
            .map((row) => decodeEvent(row.payload));
          const title = events.find((event) => event.type === 'NoteTitleRequested');
          const reply = events.find((event) => event.type === 'NoteGenerationRequested');

          assert.ok(title && title.type === 'NoteTitleRequested');
          assert.ok(reply && reply.type === 'NoteGenerationRequested');
          expect(title.messages.map((message) => message.messageId)).toStrictEqual([
            noteMessage.id
          ]);
          expect(
            (yield* notes.titleSnapshot({ requestId: title.requestId })).messages
          ).toStrictEqual(title.messages);
          const thread = yield* notes.thread({ noteId: note.id, limit: 10 });

          assert.strictEqual(thread.items.length, 2);
          assert.ok(thread.items[1]?.versions[0]?.status === 'pending');
          const manual = yield* notes.requestTitle({ noteId: note.id });

          expect((yield* notes.titleSnapshot(manual)).messages).toStrictEqual(title.messages);
          yield* notes.editMessage({ messageId: noteMessage.id, text: 'New context' });
          assert.ok((yield* Effect.flip(notes.titleSnapshot(manual))).kind === 'invalid_input');
        }).pipe(Effect.provide(layer))
      );
    } finally {
      context.close();
      await location.cleanup();
    }
  }
);

test.server.stable(
  'reply publication refreshes automatic titles durably and idempotently without replacing user titles',
  async ({ databases, assert: assertions }) => {
    const assert: test.Assert = assertions;

    const location = await databases();
    const context = new ServerContext(await location.open());
    const layer = Layer.merge(Notes.layer, Settings.layer).pipe(
      Layer.provideMerge(Layer.succeed(Database, { store: context }))
    );

    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const notes = yield* Notes;
          const settings = yield* Settings;

          yield* settings.saveWorkspacePreferences({
            ...defaultWorkspacePreferences,
            autoTitleNotes: true
          });
          const note = yield* notes.createUntitledNote({});

          yield* notes.postMessage({
            noteId: note.id,
            text: 'How do cells divide?',
            requestReply: true
          });
          const events = () =>
            context.db.orm
              .select()
              .from(s.workflowEvents)
              .all()
              .map((row) => decodeEvent(row.payload));
          const titles = () => events().filter((event) => event.type === 'NoteTitleRequested');
          const reply = events().find((event) => event.type === 'NoteGenerationRequested');
          const original = titles()[0];

          assert.ok(reply && reply.type === 'NoteGenerationRequested');
          assert.ok(original);
          const publication = {
            requestId: reply.requestId,
            text: 'Cells divide through mitosis.',
            citations: []
          };

          yield* withTestPublication(context, notes.publishReply(publication).pipe(Effect.asVoid));
          assert.ok(
            (yield* Effect.flip(notes.titleSnapshot({ requestId: original.requestId }))).kind ===
              'invalid_input'
          );
          assert.strictEqual(titles().length, 2);
          const refreshed = titles()[1]!;

          assert.strictEqual(
            (yield* notes.titleSnapshot({ requestId: refreshed.requestId })).messages.length,
            2
          );
          yield* withTestPublication(context, notes.publishReply(publication).pipe(Effect.asVoid));
          assert.strictEqual(titles().length, 2);
          yield* withTestPublication(
            context,
            notes
              .publishTitle({ requestId: refreshed.requestId, title: 'Cell division' })
              .pipe(Effect.asVoid)
          );
          assert.ok((yield* notes.note(note.id)).title === 'Cell division');
          const manual = yield* notes.createUntitledNote({});

          yield* notes.postMessage({
            noteId: manual.id,
            text: 'More biology',
            requestReply: true
          });
          const manualReply = events().findLast(
            (event) => event.type === 'NoteGenerationRequested'
          );

          assert.ok(manualReply && manualReply.type === 'NoteGenerationRequested');
          yield* notes.renameNote({ id: manual.id, title: 'My title' });
          const before = titles().length;

          yield* withTestPublication(
            context,
            notes
              .publishReply({
                requestId: manualReply.requestId,
                text: 'Biology answer',
                citations: []
              })
              .pipe(Effect.asVoid)
          );
          assert.strictEqual(titles().length, before);
          assert.ok((yield* notes.note(manual.id)).title === 'My title');
        }).pipe(Effect.provide(layer))
      );
    } finally {
      context.close();
      await location.cleanup();
    }
  }
);
