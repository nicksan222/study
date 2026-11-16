import type { agentUpdateSchema } from '@study/contracts';
import { StudyError } from '@study/contracts';
import { test } from '@study/testing';
import { Context, Effect, Fiber, Schema, Stream } from 'effect';

import { defineTool } from '#server/platform/definitions/define-agent';

import { makeAgentToolkit } from './tool-adapter.ts';
import { ProcedureTraceScope } from './trace.ts';

const previewInput = Schema.Struct({ query: Schema.String });

async function executeWithProgress(
  input: unknown,
  execute: (input: typeof previewInput.Type) => Effect.Effect<string, StudyError>,
  signal?: AbortSignal,
  observe?: (event: typeof agentUpdateSchema.Type) => Effect.Effect<void, StudyError>
) {
  const events: (typeof agentUpdateSchema.Type)[] = [];
  let result: unknown;
  let error: unknown;

  try {
    result = await Effect.runPromise(
      Effect.gen(function* () {
        const toolkit = yield* makeAgentToolkit(
          [
            [
              'sources',
              defineTool({
                description: 'Search sources',
                wiki: { when: 'Search', examples: ['Search sources'], limits: 'None' },
                input: previewInput,
                output: Schema.String,
                mutates: false,
                execute
              })
            ]
          ],
          { language: 'en', searchSources: () => Effect.succeed([]) },
          (event) =>
            Effect.sync(() => {
              events.push(event);
            }).pipe(Effect.andThen(observe?.(event) ?? Effect.void))
        );
        const stream = yield* toolkit.handle('sources', input, 'call');
        const outputs = yield* Stream.runCollect(stream);

        return outputs.at(-1)?.result;
      }).pipe(
        Effect.scoped,
        Effect.withSpan('tool-progress'),
        Effect.provideContext(Context.makeUnsafe<unknown>(new Map()))
      ),
      { signal }
    );
  } catch (cause) {
    error = cause;
  }

  return { events, result, error };
}

test.unit.stable(
  'tool previews bound actual inputs and results without truncating execution',
  async ({ expect }) => {
    const query = 'q'.repeat(13000);
    const output = 'r'.repeat(14000);
    const run = await executeWithProgress({ query }, (input) => {
      expect(input.query).toBe(query);

      return Effect.succeed(output);
    });

    expect(run.error).toBeUndefined();
    expect(run.result).toBe(output);
    expect(run.events).toEqual([
      {
        type: 'tool-start',
        toolCallId: 'call',
        toolName: 'sources',
        input: { text: JSON.stringify({ query }, null, 2).slice(0, 12000), truncated: true }
      },
      {
        type: 'tool-finish',
        toolCallId: 'call',
        toolName: 'sources',
        outcome: 'success',
        output: { text: JSON.stringify(output).slice(0, 12000), truncated: true }
      }
    ]);
  }
);

test.unit.stable(
  'native toolkit rejects invalid inputs before starting execution',
  async ({ expect }) => {
    let executed = false;
    const run = await executeWithProgress({ query: 42 }, () => {
      executed = true;

      return Effect.succeed('unused');
    });

    expect(executed).toBe(false);
    expect(run.error).toMatchObject({ reason: { _tag: 'ToolParameterValidationError' } });
    expect(run.events).toEqual([]);
  }
);

test.unit.stable(
  'typed tool failures retain their classification without exposing internal error text',
  async ({ expect }) => {
    const failure = new StudyError('not_found', 'private failure details');
    const run = await executeWithProgress({ query: 'topic' }, () => Effect.fail(failure));

    expect(run.error).toBe(failure);
    expect(run.events.at(-1)).toEqual({
      type: 'tool-finish',
      toolCallId: 'call',
      toolName: 'sources',
      outcome: 'failure',
      errorKind: 'not_found'
    });
  }
);

test.unit.stable('aborting a running tool emits a cancelled finish', async ({ expect }) => {
  const controller = new AbortController();
  const run = await executeWithProgress(
    { query: 'topic' },
    () => Effect.sync(() => controller.abort()).pipe(Effect.andThen(Effect.never)),
    controller.signal
  );

  expect(run.error).toBeDefined();
  expect(run.events.at(-1)).toEqual({
    type: 'tool-finish',
    toolCallId: 'call',
    toolName: 'sources',
    outcome: 'cancelled',
    errorKind: 'cancelled'
  });
});

test.unit.stable(
  'typed cancellation finishes as cancelled rather than failed',
  async ({ expect }) => {
    const failure = new StudyError('cancelled', 'Tool lease expired');
    const run = await executeWithProgress({ query: 'topic' }, () => Effect.fail(failure));

    expect(run.error).toBe(failure);
    expect(run.events.at(-1)).toEqual({
      type: 'tool-finish',
      toolCallId: 'call',
      toolName: 'sources',
      outcome: 'cancelled',
      errorKind: 'cancelled'
    });
  }
);

test.unit.stable('unexpected tool defects finish as internal failures', async ({ expect }) => {
  const run = await executeWithProgress({ query: 'topic' }, () =>
    Effect.die(new Error('private defect'))
  );

  expect(run.error).toBeDefined();
  expect(run.events.at(-1)).toEqual({
    type: 'tool-finish',
    toolCallId: 'call',
    toolName: 'sources',
    outcome: 'failure',
    errorKind: 'internal'
  });
});

test.unit.stable(
  'a failed success-preview write never reclassifies completed tool work as a failure',
  async ({ expect }) => {
    let executed = 0;
    const run = await executeWithProgress(
      { query: 'topic' },
      () =>
        Effect.sync(() => {
          executed++;

          return 'Done';
        }),
      undefined,
      (event) =>
        event.type === 'tool-finish'
          ? Effect.fail(new StudyError('transient', 'Preview unavailable'))
          : Effect.void
    );

    expect(executed).toBe(1);
    expect(run.error).toBeDefined();
    expect(run.events).toHaveLength(2);
    expect(run.events.at(-1)).toMatchObject({ type: 'tool-finish', outcome: 'success' });
  }
);

test.unit.stable(
  'native tool handlers retain ancestry and add their tool call identity',
  async ({ expect }) => {
    const run = await executeWithProgress({ query: 'cells' }, () =>
      Effect.gen(function* () {
        expect(yield* ProcedureTraceScope).toMatchObject({
          parentRunId: null,
          parentToolCallId: 'call',
          toolKey: 'sources:1'
        });

        return 'ok';
      })
    );

    expect(run.error).toBeUndefined();
    expect(run.result).toBe('ok');
  }
);

test.unit.stable(
  'native tools preserve decoded mock inputs and durable JSON receipts',
  async ({ createAiMock, expect }) => {
    using mock = createAiMock();
    const receipts: { name: string; ordinal: number; input: Schema.Json; mutates: boolean }[] = [];
    let actualCalls = 0;
    const definition = defineTool({
      description: 'Resolve identifiers',
      wiki: { when: 'Lookup', examples: ['Resolve an identifier'], limits: 'None' },
      input: Schema.Struct({ id: Schema.BigIntFromString }),
      output: Schema.Struct({ id: Schema.BigIntFromString }),
      mutates: true,
      execute: () =>
        Effect.sync(() => {
          actualCalls++;

          return { id: 99n };
        })
    });

    mock.next(definition, { input: { id: 1n }, output: { id: 2n } });
    mock.next(definition, { input: { id: 3n }, output: { id: 4n } });
    const results = await Effect.runPromise(
      Effect.gen(function* () {
        const toolkit = yield* makeAgentToolkit(
          [['lookup', definition]],
          {
            language: 'en',
            searchSources: () => Effect.succeed([]),
            executeTool: mock.runtime.executeTool,
            runTool: (call, execute) => {
              receipts.push(call);

              return execute;
            }
          },
          () => Effect.void
        );
        const first = yield* toolkit
          .handle('lookup', { id: '1' }, 'first')
          .pipe(Effect.flatMap(Stream.runCollect));
        const second = yield* toolkit
          .handle('lookup', { id: '3' }, 'second')
          .pipe(Effect.flatMap(Stream.runCollect));

        return [first.at(-1), second.at(-1)];
      }).pipe(Effect.scoped, Effect.provideContext(Context.makeUnsafe<unknown>(new Map())))
    );

    expect(actualCalls).toBe(0);
    expect(receipts).toEqual([
      { name: 'lookup', ordinal: 1, input: { id: '1' }, mutates: true },
      { name: 'lookup', ordinal: 2, input: { id: '3' }, mutates: true }
    ]);
    expect(results).toMatchObject([
      { result: { id: 2n }, encodedResult: { id: '2' } },
      { result: { id: 4n }, encodedResult: { id: '4' } }
    ]);
  }
);

test.unit.stable(
  'durable tool receipts replay without executing feature code',
  async ({ expect }) => {
    let actualCalls = 0;
    const definition = defineTool({
      description: 'Resolve identifiers',
      wiki: { when: 'Lookup', examples: ['Resolve an identifier'], limits: 'None' },
      input: Schema.Struct({ id: Schema.Int }),
      output: Schema.Struct({ id: Schema.BigIntFromString }),
      mutates: true,
      execute: () =>
        Effect.sync(() => {
          actualCalls++;

          return { id: 99n };
        })
    });
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const toolkit = yield* makeAgentToolkit(
          [['lookup', definition]],
          {
            language: 'en',
            searchSources: () => Effect.succeed([]),
            runTool: () => Effect.succeed({ id: '5' })
          },
          () => Effect.void
        );
        const values = yield* toolkit
          .handle('lookup', { id: 1 })
          .pipe(Effect.flatMap(Stream.runCollect));

        return values.at(-1);
      }).pipe(Effect.scoped, Effect.provideContext(Context.makeUnsafe<unknown>(new Map())))
    );

    expect(actualCalls).toBe(0);
    expect(result).toMatchObject({ result: { id: 5n }, encodedResult: { id: '5' } });
  }
);

test.unit.stable(
  'native tool handlers keep feature services through mock and receipt hooks',
  async ({ expect }) => {
    class Feature extends Context.Service<Feature, { value: string }>()('ToolAdapterFeature') {}

    const definition = defineTool({
      description: 'Read feature value',
      wiki: { when: 'Read', examples: ['Read feature state'], limits: 'None' },
      input: Schema.Struct({}),
      output: Schema.String,
      mutates: false,
      execute: () => Effect.map(Feature, (feature) => feature.value)
    });
    const toolkit = await Effect.runPromise(
      makeAgentToolkit(
        [['feature', definition]],
        {
          language: 'en',
          searchSources: () => Effect.succeed([]),
          executeTool: (_call, execute) => execute(),
          runTool: (_call, execute) => execute
        },
        () => Effect.void
      ).pipe(Effect.provideService(Feature, { value: 'feature state' }))
    );
    const result = await Effect.runPromise(
      toolkit
        .handle('feature', {}, 'feature-call')
        .pipe(
          Effect.flatMap(Stream.runCollect),
          Effect.scoped,
          Effect.provideContext(Context.makeUnsafe<unknown>(new Map()))
        )
    );

    expect(result.at(-1)?.result).toBe('feature state');
  }
);

test.unit.stable(
  'native workflow self-interruption closes the toolkit result stream',
  async ({ expect }) => {
    const run = await executeWithProgress({ query: 'topic' }, () =>
      Effect.interruptible(
        Effect.callback<never>(() => {
          const fiber = Fiber.getCurrent()!;

          fiber.interruptUnsafe(fiber.id);
        })
      )
    );

    expect(run.error).toBeDefined();
    expect(run.events.at(-1)).toMatchObject({
      type: 'tool-finish',
      outcome: 'cancelled',
      errorKind: 'cancelled'
    });
  }
);
