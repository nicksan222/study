/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Tests complete material generation with original documents and durable SQLite      │
 * │ execution.                                                                               │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Exercises late evidence and invalid provenance with provider fixtures.                 │
 * │ - Verifies final constraints and persisted replay without further generation.            │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Tests use official workflows and real storage; provider fixtures replace model requests. │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import type { MaterialVersionId } from '@study/contracts';
import { materialGenerationPublicationSchema } from '@study/contracts';
import { defaultAgentRules } from '@study/contracts';
import { plainBlock } from '@study/contracts';
import { executionIdSchema } from '@study/contracts';
import * as s from '@study/db';
import type { createTestDatabase } from '@study/db/testing';
import {
  agentsLayer,
  ServerContext,
  Database,
  defineActivity,
  WorkflowConfiguration,
  cancelExecution,
  workflowEngineLayer,
  decodeEvent,
  retryResumableActivity
} from '@study/server';
import { test } from '@study/testing';
import { Effect, Layer, Option, Schedule, Stream } from 'effect';
import { AiError, LanguageModel, Model, Response } from 'effect/ai';
import type { MessageStorage, Sharding } from 'effect/cluster';
import { WorkflowEngine, DurableDeferred } from 'effect/workflow';

import { Materials } from '#server/features/materials/service/index';
import { Pages } from '#server/features/pages/index';
import { Projects } from '#server/features/projects/index';
import { Sources } from '#server/features/sources/index';
import { admitTestExecution, withTestAdmission } from '#testing/workflow-admission';

import { materialGenerationHandler, materialGenerationWorkflow } from './generation.ts';

async function generationFixture(
  { assert: assertions }: Pick<test.server.Context, 'assert'>,
  databases: (folder?: string) => Promise<Awaited<ReturnType<typeof createTestDatabase>>>,
  texts: string[],
  options: {
    invalidMap?: boolean;
    invalidReduce?: boolean;
    invalidFinal?: boolean;
    practice?: boolean;
    questionCount?: number;
    retireAfterMap?: boolean;
    cancelAfterMap?: boolean;
  } = {}
) {
  const assert: test.Assert = assertions;

  const location = await databases();
  let context = new ServerContext(await location.open());
  const prompts: string[] = [];
  let mapCalls = 0;
  let reduceCalls = 0;
  let finalCalls = 0;
  let completedReply = false;
  let retire: (() => Promise<void>) | undefined;
  let cancel: (() => Promise<void>) | undefined;
  const afterMap = async () => {
    if (options.retireAfterMap) await retire?.();

    if (options.cancelAfterMap) await cancel?.();
  };
  const output = (input: LanguageModel.ProviderOptions) =>
    Effect.tryPromise({
      try: async () => {
        const prompt = JSON.stringify(input.prompt);

        prompts.push(prompt);
        const map = prompt.includes('Extract study notes for this material request');
        const reduce = prompt.includes('Reduce study notes into');
        let output: unknown;

        if (prompt.includes('Plan fresh learning coverage')) {
          output = { focus: ['Explore distinct supported concepts'] };
        } else if (prompt.includes('Review learning exercise novelty')) {
          output = { duplicates: [] };
        } else if (map || reduce) {
          if (map) mapCalls++;
          else reduceCalls++;

          output = notesOutput(prompt, map, map ? options.invalidMap : options.invalidReduce);

          if (map) await afterMap();
        } else {
          finalCalls++;
          output = quizOutput(prompt, options.invalidFinal, options.questionCount);
        }

        return JSON.stringify(output);
      },
      catch: (cause) =>
        AiError.make({
          module: 'fixture',
          method: 'generateText',
          reason: new AiError.UnknownError({ description: String(cause) })
        })
    });
  const finish = Response.makePart('finish', {
    reason: 'stop',
    usage: new Response.Usage({ inputTokens: { total: 1 }, outputTokens: { total: 1 } })
  });
  const model = Model.make(
    'fixture' as string,
    'fixture',
    Layer.effect(
      LanguageModel.LanguageModel,
      LanguageModel.make({
        generateText: (input) =>
          output(input).pipe(Effect.map((text) => [Response.makePart('text', { text }), finish])),
        streamText: (input) =>
          Stream.unwrap(
            output(input).pipe(
              Effect.map((text) =>
                Stream.fromArray([
                  Response.makePart('text-start', { id: 'text' }),
                  Response.makePart('text-delta', { id: 'text', delta: text }),
                  Response.makePart('text-end', { id: 'text' }),
                  finish
                ])
              )
            )
          )
      })
    )
  );

  const domain = () =>
    Layer.mergeAll(Projects.layer, Materials.layer, Sources.layer, Pages.layer).pipe(
      Layer.provideMerge(Layer.succeed(Database, { store: context }))
    );
  const services = () =>
    Layer.mergeAll(
      domain(),
      workflowEngineLayer(context),
      Layer.succeed(WorkflowConfiguration, { revision: Effect.succeed('test') }),
      agentsLayer({
        model: () => Effect.succeed(model),
        language: 'en',
        rules: Effect.succeed(defaultAgentRules),
        searchSources: () => Effect.die('global source search')
      })
    );
  const prepared = await Effect.runPromise(
    Effect.gen(function* () {
      const project = yield* (yield* Projects).createProject({ name: 'Pieces' });
      const page = yield* (yield* Pages).create({
        createKey: crypto.randomUUID(),
        projectId: project.id,
        title: 'Exact evidence',
        inputs: [],
        citations: [],
        document: {
          blocks: texts.map((text) => plainBlock('paragraph', text, { type: 'authored' })),
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

      yield* (yield* Materials).requestMaterialGeneration({
        projectId: project.id,
        title: 'Complete quiz',
        kind: 'quiz',
        inputs: [{ kind: 'page', versionId: page.version!.id }],
        questionSpec: options.practice ? { kind: 'open', count: 1 } : undefined,
        quizConfig: options.practice
          ? undefined
          : { questionCount: 1, choiceCount: 2, questionKind: 'open', difficulty: 'balanced' }
      });

      return { pageId: page.id, versionId: page.version!.id };
    }).pipe(Effect.provide(domain()))
  );

  retire = () =>
    Effect.runPromise(
      Effect.flatMap(Pages, (pages) => pages.archive({ id: prepared.pageId, archived: true })).pipe(
        Effect.asVoid,
        Effect.provide(domain())
      )
    );
  const event = decodeEvent(context.db.orm.select().from(s.workflowEvents).all().at(-1)!.payload);

  assert.equal(event.type, 'MaterialGenerationRequested');

  if (event.type !== 'MaterialGenerationRequested') throw new Error('wrong event');

  const execute = () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const engine = yield* WorkflowEngine.WorkflowEngine;
          const cancellationServices = yield* Effect.context<
            WorkflowEngine.WorkflowEngine | Sharding.Sharding | MessageStorage.MessageStorage
          >();

          cancel = () =>
            Effect.runPromise(
              cancelExecution(context, [materialGenerationWorkflow], {
                id: executionIdSchema.make(event.requestId),
                mode: 'unsafe'
              }).pipe(Effect.provide(cancellationServices))
            );

          yield* engine.register(materialGenerationWorkflow, materialGenerationHandler);

          if (completedReply) {
            const gate = DurableDeferred.make('completed-before-publication');

            yield* DurableDeferred.succeed(gate, {
              token: DurableDeferred.tokenFromExecutionId(gate, {
                workflow: materialGenerationWorkflow,
                executionId: event.requestId
              }),
              value: undefined
            });
          }

          return yield* withTestAdmission(
            context,
            materialGenerationWorkflow,
            event.requestId,
            { event },
            engine
              .execute(materialGenerationWorkflow, {
                executionId: event.requestId,
                payload: { event }
              })
              .pipe(Effect.timeout('10 seconds'))
          );
        }).pipe(Effect.provide(services()))
      )
    );

  const completedProcedure = () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          completedReply = true;
          const engine = yield* WorkflowEngine.WorkflowEngine;
          const gate = DurableDeferred.make('completed-before-publication');

          yield* engine.register(materialGenerationWorkflow, () =>
            Effect.gen(function* () {
              yield* retryResumableActivity(
                defineActivity({
                  name: 'procedure/generate-material-1/material-generation-v1',
                  success: materialGenerationPublicationSchema,
                  execute: Effect.succeed({
                    requestId: event.requestId,
                    generationEventId: event.eventId,
                    content: {
                      kind: 'quiz' as const,
                      questions: [
                        {
                          kind: 'open' as const,
                          prompt: 'Saved question',
                          explanation: 'Original evidence [1]',
                          referenceAnswer: 'Saved answer'
                        }
                      ]
                    },
                    citations: [
                      {
                        marker: 1n,
                        input: { kind: 'page' as const, versionId: prepared.versionId },
                        blockOrdinal: 0,
                        quote: texts[0]!.slice(0, 1000)
                      }
                    ]
                  })
                })
              );
              yield* DurableDeferred.await(gate);

              return yield* Effect.die('Fixture handler must remain suspended');
            })
          );
          yield* Effect.sync(() =>
            admitTestExecution(context, materialGenerationWorkflow, event.requestId, { event })
          );
          yield* engine.execute(materialGenerationWorkflow, {
            executionId: event.requestId,
            payload: { event },
            discard: true
          });
          yield* engine.poll(materialGenerationWorkflow, event.requestId).pipe(
            Effect.repeat({
              until: (reply) => Option.isSome(reply) && reply.value._tag === 'Suspended',
              schedule: Schedule.spaced('5 millis')
            }),
            Effect.timeout('10 seconds')
          );
        }).pipe(Effect.provide(services()))
      )
    );

  return {
    prompts,
    execute,
    completedProcedure,
    evidence: (id: MaterialVersionId) =>
      Effect.runPromise(
        Effect.flatMap(Materials, (materials) => materials.citations({ id, limit: 10 })).pipe(
          Effect.provide(domain())
        )
      ),
    counts: () => ({ mapCalls, reduceCalls, finalCalls }),
    published: () =>
      context.db.orm
        .select()
        .from(s.material_generation_requests)
        .all()
        .filter((row) => row.result_version_id !== null).length,
    reopen: async () => {
      context.close();
      context = new ServerContext(await location.open());
    },
    close: async () => {
      context.close();
    }
  };
}

test.server.stable(
  'maps every original block beyond the former prefix before one final quiz and replays it',
  async ({ databases, expect, assert: assertions }) => {
    const assert: test.Assert = assertions;

    const fixture = await generationFixture(
      { assert },
      databases,
      Array.from({ length: 240 }, (_, index) => `${'alpha '.repeat(100)}block-${index}-tail`)
    );

    try {
      const version = await fixture.execute();

      expect(fixture.prompts.some((prompt) => prompt.includes('block-239-tail'))).toBe(true);
      expect(fixture.counts().mapCalls).toBeGreaterThan(1);
      expect(fixture.counts().reduceCalls).toBeGreaterThan(3);
      const mapPrompts = fixture.prompts.filter((value) =>
        value.includes('Extract study notes for this material request')
      );

      for (let index = 0; index < 240; index++)
        expect(mapPrompts.join('\n')).toContain(`block-${index}-tail`);

      // Planning and candidate generation each prepare their own source context.
      for (const candidate of [false, true]) {
        const originalMarkers = mapPrompts
          .filter((value) => value.includes('Fresh coverage plan (derived guidance') === candidate)
          .flatMap((value) =>
            Array.from(value.matchAll(/\[(\d+)\]/g), (match) => Number(match[1]))
          );

        expect(new Set(originalMarkers).size).toBe(originalMarkers.length);
        expect(Math.max(...originalMarkers)).toBeGreaterThan(200);
      }

      expect(fixture.counts().finalCalls).toBe(1);
      expect(fixture.published()).toBe(1);
      const evidence = await fixture.evidence(version);

      expect(evidence.items).toHaveLength(1);
      expect(evidence.items[0]!.quote).toContain('block-239-tail');
      expect(evidence.items[0]!.quote).not.toContain('Tail concept');
      expect(evidence.items[0]!.target).toMatchObject({
        start: 0,
        end: evidence.items[0]!.quote.length
      });
      const calls = fixture.prompts.length;

      await fixture.reopen();
      expect(await fixture.execute()).toBe(version);
      expect(fixture.prompts).toHaveLength(calls);
    } finally {
      await fixture.close();
    }
  }
);

test.server.stable(
  'maps the canonical tail of one oversized block',
  async ({ databases, expect, assert: assertions }) => {
    const assert: test.Assert = assertions;

    const fixture = await generationFixture({ assert }, databases, [
      `${'alpha '.repeat(30000)}single-block-tail`
    ]);

    try {
      const version = await fixture.execute();

      expect(fixture.prompts.some((prompt) => prompt.includes('single-block-tail'))).toBe(true);
      const evidence = await fixture.evidence(version);
      const citation = evidence.items[0]!;

      expect(citation.quote).toContain('single-block-tail');
      expect(citation.target!.start).toBeGreaterThan(100_000);
      expect(
        ('alpha '.repeat(30000) + 'single-block-tail').slice(
          citation.target!.start,
          citation.target!.end
        )
      ).toBe(citation.quote);
    } finally {
      await fixture.close();
    }
  }
);

test.server.stable(
  'small generation exposes original passages inline without a notes request',
  async ({ databases, expect, assert: assertions }) => {
    const assert: test.Assert = assertions;

    const fixture = await generationFixture({ assert }, databases, ['small-tail']);

    try {
      await fixture.execute();
      expect(fixture.counts()).toEqual({ mapCalls: 0, reduceCalls: 0, finalCalls: 1 });
      expect(fixture.prompts[0]).toContain('small-tail');
    } finally {
      await fixture.close();
    }
  }
);

for (const [name, options] of [
  ['forged map provenance', { invalidMap: true }],
  ['forged reduction provenance', { invalidReduce: true }],
  ['forged final provenance', { invalidFinal: true }],
  ['multiplied final question count', { questionCount: 2 }],
  ['multiplied practice question count', { practice: true, questionCount: 2 }]
] as const) {
  test.server.stable(
    `refuses ${name} without publishing`,
    async ({ databases, expect, assert: assertions }) => {
      const assert: test.Assert = assertions;

      const fixture = await generationFixture(
        { assert },
        databases,
        ['alpha '.repeat(6000)],
        options
      );

      try {
        await expect(fixture.execute()).rejects.toMatchObject({ kind: 'invalid_input' });
        expect(fixture.published()).toBe(0);

        if ('invalidMap' in options) expect(fixture.counts().mapCalls).toBe(1);

        if ('invalidReduce' in options) expect(fixture.counts().reduceCalls).toBe(1);
      } finally {
        await fixture.close();
      }
    }
  );
}

test.server.stable(
  'stops before another piece when original input is archived during mapping',
  async ({ databases, expect, assert: assertions }) => {
    const assert: test.Assert = assertions;

    const fixture = await generationFixture({ assert }, databases, ['alpha '.repeat(6000)], {
      retireAfterMap: true
    });

    try {
      await expect(fixture.execute()).rejects.toSatisfy(() => true);
      expect(fixture.counts()).toEqual({ mapCalls: 1, reduceCalls: 0, finalCalls: 0 });
      expect(fixture.published()).toBe(0);
    } finally {
      await fixture.close();
    }
  }
);

test.server.stable(
  'stops before another piece when generation is canceled during mapping',
  async ({ databases, expect, assert: assertions }) => {
    const assert: test.Assert = assertions;

    const fixture = await generationFixture({ assert }, databases, ['alpha '.repeat(6000)], {
      cancelAfterMap: true
    });

    try {
      await expect(fixture.execute()).rejects.toSatisfy(() => true);
      expect(fixture.counts()).toEqual({ mapCalls: 1, reduceCalls: 0, finalCalls: 0 });
      expect(fixture.published()).toBe(0);
    } finally {
      await fixture.close();
    }
  }
);

function notesOutput(prompt: string, map: boolean, invalid = false) {
  const markers = map
    ? Array.from(prompt.matchAll(/\[(\d+)\]/g), (match) => Number(match[1]))
    : Array.from(prompt.matchAll(/markers\\?":\[(\d+)/g), (match) => Number(match[1]));

  return { notes: [{ text: 'Tail concept', markers: [invalid ? 999999 : markers.at(-1)!] }] };
}

function quizOutput(prompt: string, invalid = false, count = 1) {
  const marker = invalid
    ? 999999
    : Array.from(prompt.matchAll(/\[(\d+)\]/g), (match) => Number(match[1])).at(-1)!;

  return {
    kind: 'quiz',
    questions: Array.from({ length: count }, () => ({
      kind: 'open',
      prompt: 'Explain the tail',
      referenceAnswer: 'Tail concept',
      explanation: `Original evidence [${marker}]`
    }))
  };
}

test.server.stable(
  'replays a completed generation procedure receipt after reopening',
  async ({ databases, expect, assert: assertions }) => {
    const assert: test.Assert = assertions;
    const fixture = await generationFixture({ assert }, databases, ['saved exact evidence']);

    try {
      await fixture.completedProcedure();
      expect(fixture.prompts).toHaveLength(0);
      await fixture.reopen();
      await fixture.execute();
      expect(fixture.prompts).toHaveLength(0);
      expect(fixture.published()).toBe(1);
    } finally {
      await fixture.close();
    }
  }
);
