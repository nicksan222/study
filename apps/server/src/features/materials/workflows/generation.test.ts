/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Checks generation rejects mismatched event identity before provider access and     │
 * │ publishes each material kind with captured evidence and replayable receipts.             │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Uses provider stubs to verify identity checks precede generation and publication.      │
 * │ - Asserts durable effects against persisted state and replay behavior.                   │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ The suite drives the native workflow engine with persisted test state; it does not       │
 * │ replace production activities.                                                           │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { plainBlock } from '@study/contracts/sources/document';
import { sql } from '@study/db';
import * as s from '@study/db/schema';
import { createTestDatabase } from '@study/db/testing';
import { testStable } from '@study/testing/vitest';
import { Effect, Exit, Layer, Schema } from 'effect';
import { Workflow, WorkflowEngine } from 'effect/workflow';
import { assert, expect } from 'vite-plus/test';

import { Documents } from '#server/features/documents/index';
import { Materials } from '#server/features/materials/service/index';
import { Projects } from '#server/features/projects/index';
import { Sources } from '#server/features/sources/index';
import {
  sourceIngestionWorkflow,
  sourceIngestionHandler
} from '#server/features/sources/workflows/index';
import { layer as agentsLayer } from '#server/platform/ai/agents';
import { ServerContext } from '#server/platform/database/context';
import { Database } from '#server/platform/database/database';
import { WorkflowConfiguration } from '#server/platform/workflows/configuration';
import { workflowEngineLayer } from '#server/platform/workflows/engine';
import { decodeEvent } from '#server/platform/workflows/events';
import { workflowStore } from '#server/platform/workflows/store';

import { materialGenerationWorkflow, materialGenerationHandler } from './generation.ts';

testStable('rejects mismatched generation event before reaching a provider', async () => {
  const location = createTestDatabase();
  const context = new ServerContext(location.open());
  const database = Layer.succeed(Database, { store: context });
  const domain = Layer.mergeAll(
    Projects.layer,
    Materials.layer,
    Sources.layer,
    Documents.layer
  ).pipe(Layer.provideMerge(database));
  const services = Layer.mergeAll(
    domain,
    database,
    workflowEngineLayer(context),
    Layer.succeed(WorkflowConfiguration, { revision: Effect.succeed('test') }),
    agentsLayer({
      model: () => Effect.die('unexpected model'),
      language: 'en',
      searchSources: () => Effect.succeed([])
    })
  );

  try {
    const event = await Effect.runPromise(
      Effect.gen(function* () {
        const projects = yield* Projects;
        const materials = yield* Materials;
        const project = yield* projects.createProject({ name: 'test' });
        const doc = yield* (yield* Documents).create({
          createKey: crypto.randomUUID(),
          inputs: [],
          citations: [],
          projectId: project.id,
          title: 'doc',
          document: {
            blocks: [plainBlock('paragraph', 'alpha', { type: 'authored' })],
            meta: {
              extractor: null,
              extractorVersion: 1,
              provider: null,
              durationMs: null,
              pageCount: null,
              refiners: [],
              waitingFor: [],
              corrected: false,
              omissions: []
            }
          }
        });

        yield* materials.requestMaterialGeneration({
          projectId: project.id,
          title: 'cards',
          kind: 'flashcards',
          inputs: [{ kind: 'document', versionId: doc.version!.id }]
        });
        const value = decodeEvent(
          context.db.orm.select().from(s.workflowEvents).all().at(-1)!.payload
        );

        assertEventType(value, 'MaterialGenerationRequested', 'wrong event');

        return value;
      }).pipe(Effect.provide(domain))
    );

    await expect(
      Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const engine = yield* WorkflowEngine.WorkflowEngine;

            yield* engine.register(materialGenerationWorkflow, materialGenerationHandler);

            return yield* engine.execute(materialGenerationWorkflow, {
              executionId: 'mismatch',
              payload: { event: { ...event, kind: 'quiz' } }
            });
          }).pipe(Effect.provide(services))
        )
      )
    ).rejects.toSatisfy(() => true);
  } finally {
    context.close();
    location.cleanup();
  }
});

testStable(
  'generates and publishes all material kinds with captured evidence and replays receipts',
  async () => {
    const { createServer } = await import('node:http');
    const { createChatGptModel } = await import('#server/platform/ai/providers/chatgpt/model');
    const { AuthManager } = await import('#server/platform/ai/providers/chatgpt/session');
    const location = createTestDatabase();
    let context = new ServerContext(location.open());
    let calls = 0;
    let tool = true;
    let output = '';
    let invalidDiagram = false;
    let duringModel: (() => Promise<void>) | undefined;
    let duringCall: (() => Promise<void>) | undefined;
    let cancel: (() => Promise<void>) | undefined;
    const bodies: string[] = [];
    const peer = createServer(async (req, res) => {
      let body = '';

      for await (const chunk of req) body += chunk;

      bodies.push(body);
      calls++;
      const action = duringCall;

      duringCall = undefined;
      await action?.();
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const call = {
        type: 'function_call',
        id: 'item1',
        call_id: 'call1',
        name: 'sources',
        arguments: '{"query":"alpha"}'
      };
      const invalid = !tool && invalidDiagram;

      if (invalid) invalidDiagram = false;

      const events = tool
        ? [
            { type: 'response.output_item.added', output_index: 0, item: call },
            {
              type: 'response.output_item.done',
              output_index: 0,
              item: { ...call, status: 'completed' }
            },
            { type: 'response.completed', response: {} }
          ]
        : [
            {
              type: 'response.output_item.added',
              output_index: 0,
              item: { type: 'message', id: 'item' }
            },
            {
              type: 'response.output_text.delta',
              item_id: 'item',
              delta: invalid
                ? JSON.stringify({
                    kind: 'diagram',
                    format: 'mermaid',
                    payload: 'flowchart TD\nA["broken [1]'
                  })
                : output
            },
            { type: 'response.completed', response: {} }
          ];

      tool = invalid;

      for (const event of events) res.write(`data: ${JSON.stringify(event)}\n\n`);

      res.end('data: [DONE]\n\n');
    });

    await new Promise<void>((resolve) => peer.listen(0, '127.0.0.1', resolve));
    const address = peer.address();

    if (!address || typeof address === 'string') throw Error('missing address');

    const base = `http://127.0.0.1:${address.port}`;
    const auth = new AuthManager({ issuer: base, saveRefresh: async () => {} });

    await auth.replace(
      { subject: 'u', clientId: 'c', sharing: true, refreshToken: 'r' },
      { accessToken: 'token', expiresIn: 3600 }
    );
    const model = createChatGptModel({ auth, modelId: 'test', baseUrl: base });
    const domain = () =>
      Layer.mergeAll(Projects.layer, Materials.layer, Sources.layer, Documents.layer).pipe(
        Layer.provideMerge(Layer.succeed(Database, { store: context }))
      );
    const services = () =>
      Layer.mergeAll(
        domain(),
        Layer.succeed(Database, { store: context }),
        workflowEngineLayer(context),
        Layer.succeed(WorkflowConfiguration, { revision: Effect.succeed('test') }),
        agentsLayer({
          model: () =>
            Effect.promise(async () => {
              const action = duringModel;

              duringModel = undefined;
              await action?.();

              return model;
            }),
          language: 'en',
          searchSources: () => Effect.die('global search')
        })
      );

    try {
      const doc = await Effect.runPromise(
        Effect.gen(function* () {
          const project = yield* (yield* Projects).createProject({ name: 'test' });

          const sources = yield* Sources;
          const source = yield* sources.createSource({
            projectId: project.id,
            name: 'evidence.txt',
            bytes: new TextEncoder().encode('alpha evidence')
          });
          const state = yield* sources.sourceProcessing(source.id);

          assert.ok(state.requestId);
          const engine = yield* WorkflowEngine.WorkflowEngine;

          yield* engine.register(sourceIngestionWorkflow, sourceIngestionHandler);
          yield* engine.execute(sourceIngestionWorkflow, {
            executionId: 'import-evidence',
            payload: {
              event: {
                type: 'SourceProcessingRequested',
                eventId: 'import-evidence',
                causationId: null,
                correlationId: state.requestId,
                inputVersion: state.revision,
                depth: 0,
                sourceId: source.id,
                requestId: state.requestId
              }
            }
          });
          const exact = yield* sources.currentExtraction({ id: source.id });

          assert.ok(exact);
          assert.strictEqual(context.db.orm.select().from(s.materials).all().length, 0);

          return {
            projectId: project.id,
            sourceId: source.id,
            input: {
              kind: 'source' as const,
              sourceId: source.id,
              revision: exact.revision,
              snapshotId: exact.snapshotId
            }
          };
        }).pipe(Effect.scoped, Effect.provide(services()))
      );
      const generate = async (
        kind: 'flashcards' | 'quiz' | 'diagram',
        content: unknown,
        failure?: 'publication' | 'validation'
      ) => {
        await Effect.runPromise(
          Effect.flatMap(Materials, (m) =>
            m.requestMaterialGeneration({
              projectId: doc.projectId,
              title: kind,
              kind,
              inputs: [doc.input]
            })
          ).pipe(Effect.provide(domain()))
        );
        const event = decodeEvent(
          context.db.orm.select().from(s.workflowEvents).all().at(-1)!.payload
        );

        assertEventType(event, 'MaterialGenerationRequested', 'wrong event');

        tool = true;
        output = JSON.stringify(content);
        invalidDiagram = failure === 'publication';
        const execute = () =>
          Effect.runPromise(
            Effect.scoped(
              Effect.gen(function* () {
                const engine = yield* WorkflowEngine.WorkflowEngine;

                yield* engine.register(materialGenerationWorkflow, materialGenerationHandler);

                return yield* engine.execute(materialGenerationWorkflow, {
                  executionId: event.requestId,
                  payload: { event }
                });
              }).pipe(Effect.provide(services()))
            )
          );

        if (failure) {
          const beforeCorrection = calls;

          if (failure === 'publication')
            context.db.orm.run(
              sql`CREATE TRIGGER fail_generation BEFORE UPDATE OF creator ON material_versions WHEN NEW.creator = 'agent' BEGIN SELECT RAISE(ABORT, 'unavailable'); END`
            );

          if (failure === 'validation') {
            const journal = workflowStore(context);
            const payload = Schema.encodeSync(
              Schema.toCodecJson(materialGenerationWorkflow.payloadSchema)
            )({ event });
            const result = Schema.encodeSync(
              Schema.toCodecJson(
                Workflow.Result({ success: Schema.Unknown, error: Schema.Unknown })
              )
            )(
              new Workflow.Complete({
                exit: Exit.fail({
                  kind: 'internal',
                  message: 'Diagram worker failed',
                  retryAfterMs: null
                })
              })
            );

            journal.start(
              event.requestId,
              materialGenerationWorkflow._tag,
              JSON.stringify(payload),
              undefined
            );
            assert.ok(journal.claim(event.requestId, 'validation-checkpoint') === true);
            journal.saveActivity(
              event.requestId,
              'validation-checkpoint',
              'validate-material-1',
              1,
              JSON.stringify(result)
            );
            journal.release(event.requestId, 'validation-checkpoint');
            context.close();
            context = new ServerContext(location.open());
          }

          let rejected: unknown;

          await expect(execute()).rejects.toSatisfy((error) => {
            rejected = error;

            return true;
          });
          const failures = context.db.orm
            .select()
            .from(s.workflowEvents)
            .all()
            .map((row) => decodeEvent(row.payload))
            .filter(
              (value) =>
                value.type === 'MaterialGenerationFailed' && value.requestId === event.requestId
            );

          assert.strictEqual(
            failures.length,
            1,
            JSON.stringify(rejected, (_key, value) =>
              value instanceof Error ? { message: value.message, cause: value.cause } : value
            )
          );
          assert.strictEqual(failures[0]?.causationId, event.eventId);
          const completedCalls = calls;

          assert.strictEqual(
            completedCalls - beforeCorrection,
            failure === 'publication' ? 4 : 2,
            JSON.stringify(rejected, (_key, value) =>
              value instanceof Error ? { message: value.message, cause: value.cause } : value
            )
          );

          if (failure === 'publication') context.db.orm.run(sql`DROP TRIGGER fail_generation`);

          context.db.orm.run(
            sql`DELETE FROM workflow_activities WHERE execution_id = ${event.requestId} AND name = ${failure === 'publication' ? 'publish-material' : 'validate-material-1'}`
          );
          context.db.orm.run(
            sql`UPDATE workflow_executions SET status = 'suspended', result = NULL, owner_token = NULL WHERE execution_id = ${event.requestId}`
          );
          context.close();
          context = new ServerContext(location.open());
          const replayed = await execute();

          assert.strictEqual(
            calls,
            completedCalls,
            'reopening must reuse both completed diagram attempts'
          );
          const version = await Effect.runPromise(
            Effect.flatMap(Materials, (m) => m.materialVersion({ id: replayed })).pipe(
              Effect.provide(domain())
            )
          );

          return version;
        }

        const id = await execute();

        expect(bodies.at(-1)!).toMatch(/alpha evidence/);
        const before = calls;

        context.close();
        context = new ServerContext(location.open());
        assert.strictEqual(await execute(), id);
        assert.strictEqual(calls, before);
        const version = await Effect.runPromise(
          Effect.flatMap(Materials, (m) => m.materialVersion({ id })).pipe(Effect.provide(domain()))
        );

        assert.strictEqual(version.kind, kind);

        return version;
      };

      await generate('flashcards', {
        kind: 'flashcards',
        cards: [{ front: 'What? [1]', back: 'alpha' }]
      });
      const quiz = await generate('quiz', {
        kind: 'quiz',
        questions: [
          {
            kind: 'single_choice',
            prompt: 'Which? [1]',
            explanation: 'alpha',
            choices: [
              { text: 'yes', isCorrect: true },
              { text: 'no', isCorrect: false }
            ]
          },
          {
            kind: 'multiple_choice',
            prompt: 'Choose [1]',
            explanation: 'alpha',
            choices: [
              { text: 'a', isCorrect: true },
              { text: 'b', isCorrect: true },
              { text: 'c', isCorrect: false }
            ]
          },
          { kind: 'open', prompt: 'Explain [1]', explanation: 'alpha', referenceAnswer: 'alpha' },
          {
            kind: 'fill_blank',
            prompt: 'The captured my_value is ____.',
            explanation: 'alpha [1]',
            referenceAnswer: 'alpha'
          },
          {
            kind: 'true_false',
            prompt: 'The captured value is alpha.',
            isTrue: true,
            explanation: 'alpha [1]'
          }
        ]
      });

      assertQuizQuestionShapes();

      function assertQuizQuestionShapes() {
        assert.ok(quiz.content.kind === 'quiz');

        if (quiz.content.kind !== 'quiz') throw Error('wrong content');

        const [single, multiple, open, blank, boolean] = quiz.content.questions;

        if (
          single?.kind !== 'single_choice' ||
          multiple?.kind !== 'multiple_choice' ||
          open?.kind !== 'open'
        )
          throw Error('wrong questions');

        expect(single.choices.map((choice) => choice.isCorrect)).toStrictEqual([true, false]);
        expect(multiple.choices.map((choice) => choice.isCorrect)).toStrictEqual([
          true,
          true,
          false
        ]);
        assert.ok(open.referenceAnswer === 'alpha');
        assert.ok(blank?.kind === 'fill_blank');
        assert.equal(blank.referenceAnswer, 'alpha');
        assert.ok(boolean?.kind === 'true_false');
        assert.deepEqual(
          boolean.choices.map((choice) => [choice.text, choice.isCorrect]),
          [
            ['true', true],
            ['false', false]
          ]
        );
      }

      await generate(
        'diagram',
        {
          kind: 'diagram',
          format: 'mermaid',
          payload: 'flowchart TD\nA["alpha [1]"] --> B["beta"]'
        },
        'publication'
      );
      await generate(
        'diagram',
        { kind: 'diagram', format: 'mermaid', payload: 'flowchart TD\nA["alpha [1]"]' },
        'validation'
      );
      const completedBefore = context.db.orm
        .select()
        .from(s.material_generation_requests)
        .all()
        .filter((row) => row.result_version_id !== null).length;

      for (const [kind, content] of [
        ['flashcards', { kind: 'flashcards', cards: [{ front: 'What?', back: 'alpha' }] }],
        [
          'quiz',
          {
            kind: 'quiz',
            questions: [
              { kind: 'open', prompt: 'Explain', explanation: 'alpha', referenceAnswer: 'alpha' }
            ]
          }
        ],
        ['diagram', { kind: 'diagram', format: 'mermaid', payload: 'flowchart TD\nA["alpha"]' }]
      ] as const) {
        await expect(generate(kind, content)).rejects.toSatisfy(() => true);
        assert.strictEqual(
          context.db.orm
            .select()
            .from(s.material_generation_requests)
            .all()
            .filter((row) => row.result_version_id !== null).length,
          completedBefore,
          'uncited output must not publish'
        );
      }

      const request = async () => {
        await Effect.runPromise(
          Effect.flatMap(Materials, (m) =>
            m.requestMaterialGeneration({
              projectId: doc.projectId,
              title: 'race',
              kind: 'flashcards',
              inputs: [doc.input]
            })
          ).pipe(Effect.provide(domain()))
        );
        const event = decodeEvent(
          context.db.orm.select().from(s.workflowEvents).all().at(-1)!.payload
        );

        assertEventType(event, 'MaterialGenerationRequested', 'wrong event');

        return event;
      };
      const executeEvent = (event: Awaited<ReturnType<typeof request>>) =>
        Effect.runPromise(
          Effect.scoped(
            Effect.gen(function* () {
              const engine = yield* WorkflowEngine.WorkflowEngine;

              cancel = () =>
                Effect.runPromise(
                  engine.interruptUnsafe(materialGenerationWorkflow, event.eventId)
                );
              yield* engine.register(materialGenerationWorkflow, materialGenerationHandler);

              return yield* engine.execute(materialGenerationWorkflow, {
                executionId: event.eventId,
                payload: { event }
              });
            }).pipe(Effect.provide(services()))
          )
        );
      const archive = () =>
        Effect.runPromise(
          Effect.flatMap(Sources, (sources) =>
            sources.setSourceProject({ id: doc.sourceId, projectId: null })
          ).pipe(Effect.provide(domain()))
        );
      const unarchive = () =>
        Effect.runPromise(
          Effect.flatMap(Sources, (sources) =>
            sources.setSourceProject({ id: doc.sourceId, projectId: doc.projectId })
          ).pipe(Effect.provide(domain()))
        );
      const stale = await request();

      await archive();
      const beforeStale = calls;

      await expect(executeEvent(stale)).rejects.toSatisfy(() => true);
      assert.strictEqual(calls, beforeStale);
      await unarchive();
      const resolver = await request();

      duringModel = async () => {
        await archive();
      };
      await expect(executeEvent(resolver)).rejects.toSatisfy(() => true);
      assert.strictEqual(calls, beforeStale);
      await unarchive();
      const racing = await request();

      tool = false;
      output = JSON.stringify({ kind: 'flashcards', cards: [{ front: 'Q', back: 'A' }] });
      duringCall = async () => {
        await archive();
      };
      await expect(executeEvent(racing)).rejects.toSatisfy(() => true);
      assert.ok(
        (
          await Effect.runPromise(
            Effect.flatMap(Materials, (m) => m.materialGeneration({ requestId: racing.requestId }))
              .pipe(Effect.provide(domain()))
              .pipe(Effect.result)
          )
        )._tag === 'Failure'
      );
      await unarchive();
      const forged = await request();

      tool = false;
      output = JSON.stringify({ kind: 'flashcards', cards: [{ front: 'Q [99]', back: 'A' }] });
      await expect(executeEvent(forged)).rejects.toSatisfy(() => true);
      assert.ok(
        (
          await Effect.runPromise(
            Effect.flatMap(Materials, (m) =>
              m.materialGeneration({ requestId: forged.requestId })
            ).pipe(Effect.provide(domain()))
          )
        ).resultVersionId === null
      );
      const failures = () =>
        context.db.orm
          .select()
          .from(s.workflowEvents)
          .all()
          .map((row) => decodeEvent(row.payload))
          .filter(
            (item) =>
              item.type === 'MaterialGenerationFailed' && item.generationEventId === forged.eventId
          );

      assert.strictEqual(failures().length, 1);
      assert.strictEqual(failures()[0]!.causationId, forged.eventId);
      assert.strictEqual(failures()[0]!.correlationId, forged.requestId);
      await expect(executeEvent(forged)).rejects.toSatisfy(() => true);
      assert.strictEqual(failures().length, 1);
      await Effect.runPromise(
        Effect.flatMap(Materials, (m) =>
          m.retryMaterialGenerationOnce({
            requestId: forged.requestId,
            retryId: 'explicit-retry'
          })
        ).pipe(Effect.provide(domain()))
      );
      const retry = decodeEvent(
        context.db.orm.select().from(s.workflowEvents).all().at(-1)!.payload
      );

      assertEventType(retry, 'MaterialGenerationRequested', 'wrong retry event');

      await expect(executeEvent({ ...retry, eventId: 'forged-retry' })).rejects.toSatisfy(
        () => true
      );
      tool = true;
      output = JSON.stringify({ kind: 'flashcards', cards: [{ front: 'Q [1]', back: 'A' }] });
      const retryVersion = await executeEvent(retry);
      const callsAfterRetry = calls;

      assert.strictEqual(await executeEvent(retry), retryVersion);
      assert.strictEqual(calls, callsAfterRetry);
      await Effect.runPromise(
        Effect.flatMap(Materials, (m) =>
          m.retryMaterialGenerationOnce({
            requestId: forged.requestId,
            retryId: 'after-receipt'
          })
        ).pipe(Effect.provide(domain()))
      );
      assert.ok(
        context.db.orm
          .select()
          .from(s.workflowEvents)
          .all()
          .some((row) => row.eventId === 'after-receipt') === false
      );
      await Effect.runPromise(
        Effect.gen(function* () {
          const materials = yield* Materials;

          yield* materials.openGenerationScope({
            scopeId: 'closed-scope',
            projectId: doc.projectId
          });
          yield* materials.requestMaterialGenerationOnce({
            requestId: 'closed-request',
            request: {
              projectId: doc.projectId,
              title: 'closed',
              kind: 'flashcards',
              inputs: [doc.input],
              scopeId: 'closed-scope'
            }
          });
          yield* materials.closeGenerationScope({
            scopeId: 'closed-scope',
            projectId: doc.projectId
          });
        }).pipe(Effect.provide(domain()))
      );
      const closedEvent = decodeEvent(
        context.db.orm.select().from(s.workflowEvents).all().at(-1)!.payload
      );

      assertEventType(closedEvent, 'MaterialGenerationRequested', 'wrong event');

      const beforeClosed = calls;

      await expect(executeEvent(closedEvent)).rejects.toSatisfy(() => true);
      assert.strictEqual(calls, beforeClosed);
      const closedFailures = context.db.orm
        .select()
        .from(s.workflowEvents)
        .all()
        .map((row) => decodeEvent(row.payload))
        .filter(
          (item) =>
            item.type === 'MaterialGenerationFailed' &&
            item.generationEventId === closedEvent.eventId
        );

      assert.strictEqual(closedFailures.length, 1);
      const cancelled = await request();

      tool = false;
      output = JSON.stringify({ kind: 'flashcards', cards: [{ front: 'Q', back: 'A' }] });
      duringCall = async () => {
        await cancel!();
      };
      await expect(executeEvent(cancelled)).rejects.toSatisfy(() => true);
      const cancelledState = await Effect.runPromise(
        Effect.flatMap(Materials, (m) =>
          m.materialGeneration({ requestId: cancelled.requestId, verifyOnly: true })
        ).pipe(Effect.provide(domain()))
      );

      assert.ok(cancelledState.resultVersionId === null);
      assert.ok(cancelledState.cancelled === true);
      const blocked = await Effect.runPromise(
        Effect.flatMap(Materials, (m) =>
          Effect.flip(m.materialGeneration({ requestId: cancelled.requestId }))
        ).pipe(Effect.provide(domain()))
      );

      assert.ok(blocked.kind === 'cancelled');
    } finally {
      await auth.dispose();
      context.close();
      location.cleanup();
      await new Promise<void>((resolve) => peer.close(() => resolve()));
    }
  }
);

function assertEventType<T extends ReturnType<typeof decodeEvent>['type']>(
  event: ReturnType<typeof decodeEvent> | undefined,
  type: T,
  message: string
): asserts event is Extract<ReturnType<typeof decodeEvent>, { type: T }> {
  assert.ok(event && event.type === type, message);
}
