import type { agentUpdateSchema } from '@study/contracts';
/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Verifies provider preflight callbacks retain the originating Effect logger and     │
 * │ propagate typed failures. This protects context across the callback bridge into the      │
 * │ model request.                                                                           │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Asserts: provider preflights inherit the scoped logger and preserve typed failures.    │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Invokes ./tool-adapter.ts directly with Vitest   ; no application or database fixture is │
 * │ involved.                                                                                │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */
import { StudyError } from '@study/contracts';
import { test } from '@study/testing';
import { Effect, Logger, Schema } from 'effect';

import { defineTool } from '#server/platform/definitions/define-agent';

import { adaptRequestCheck, adaptTool } from './tool-adapter.ts';

test.stable(
  'provider preflights inherit the scoped logger and preserve typed failures',
  async () => {
    const messages: unknown[] = [];
    const logger = Logger.make((entry) => messages.push(entry.message));

    function* verifyScopedPreflights() {
      const context = yield* Effect.context<never>();
      const span = yield* Effect.currentSpan;
      const callback = adaptRequestCheck(Effect.logInfo('Preflight checked'), span, {}, context);

      yield* Effect.promise(() => callback(undefined));
      test.assert.strictEqual(messages.length, 1);
      const error = new StudyError('invalid_input', 'stale request');
      const invalid = adaptRequestCheck(Effect.fail(error), span, {}, context);

      yield* Effect.promise(() =>
        test.expect(invalid(undefined)).rejects.toSatisfy((actual: unknown) => actual === error)
      );
    }

    await Effect.runPromise(
      Effect.gen(verifyScopedPreflights).pipe(
        Effect.withSpan('scoped-preflight'),
        Effect.provide(Logger.layer([logger]))
      )
    );
  }
);

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

  await Effect.runPromise(
    Effect.gen(function* () {
      const context = yield* Effect.context<never>();
      const span = yield* Effect.currentSpan;
      const tool = adaptTool(
        defineTool({
          description: 'Search sources',
          wiki: { when: 'Search', examples: ['Search sources'], limits: 'None' },
          input: previewInput,
          output: Schema.String,
          mutates: false,
          execute
        }),
        { language: 'en', searchSources: () => Effect.succeed([]) },
        span,
        {},
        context,
        {
          name: 'sources',
          emit: (event) =>
            Effect.sync(() => {
              events.push(event);
            }).pipe(Effect.andThen(observe?.(event) ?? Effect.void))
        }
      );

      yield* Effect.promise(async () => {
        try {
          result = await tool.execute?.(input, {
            toolCallId: 'call',
            messages: [],
            abortSignal: signal
          });
        } catch (cause) {
          error = cause;
        }
      });
    }).pipe(Effect.withSpan('tool-progress'))
  );

  return { events, result, error };
}

test.stable(
  'tool previews bound actual inputs and results without truncating execution',
  async () => {
    const query = 'q'.repeat(13000);
    const output = 'r'.repeat(14000);
    const run = await executeWithProgress({ query }, (input) => {
      test.expect(input.query).toBe(query);

      return Effect.succeed(output);
    });

    test.expect(run.error).toBeUndefined();
    test.expect(run.result).toBe(output);
    test.expect(run.events).toEqual([
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

test.stable('invalid inputs finish the visible tool with a typed failure', async () => {
  let executed = false;
  const run = await executeWithProgress({ query: 42 }, () => {
    executed = true;

    return Effect.succeed('unused');
  });

  test.expect(executed).toBe(false);
  test.expect(run.error).toMatchObject({ kind: 'invalid_input' });
  test.expect(run.events).toEqual([
    {
      type: 'tool-start',
      toolCallId: 'call',
      toolName: 'sources',
      input: { text: '{\n  "query": 42\n}', truncated: false }
    },
    {
      type: 'tool-finish',
      toolCallId: 'call',
      toolName: 'sources',
      outcome: 'failure',
      errorKind: 'invalid_input'
    }
  ]);
});

test.stable(
  'typed tool failures retain their classification without exposing internal error text',
  async () => {
    const failure = new StudyError('not_found', 'private failure details');
    const run = await executeWithProgress({ query: 'topic' }, () => Effect.fail(failure));

    test.expect(run.error).toBe(failure);
    test.expect(run.events.at(-1)).toEqual({
      type: 'tool-finish',
      toolCallId: 'call',
      toolName: 'sources',
      outcome: 'failure',
      errorKind: 'not_found'
    });
  }
);

test.stable('aborting a running tool emits a cancelled finish', async () => {
  const controller = new AbortController();
  const run = await executeWithProgress(
    { query: 'topic' },
    () => Effect.sync(() => controller.abort()).pipe(Effect.andThen(Effect.never)),
    controller.signal
  );

  test.expect(run.error).toBeDefined();
  test.expect(run.events.at(-1)).toEqual({
    type: 'tool-finish',
    toolCallId: 'call',
    toolName: 'sources',
    outcome: 'cancelled',
    errorKind: 'cancelled'
  });
});

test.stable('typed cancellation finishes as cancelled rather than failed', async () => {
  const failure = new StudyError('cancelled', 'Tool lease expired');
  const run = await executeWithProgress({ query: 'topic' }, () => Effect.fail(failure));

  test.expect(run.error).toBe(failure);
  test.expect(run.events.at(-1)).toEqual({
    type: 'tool-finish',
    toolCallId: 'call',
    toolName: 'sources',
    outcome: 'cancelled',
    errorKind: 'cancelled'
  });
});

test.stable('unexpected tool defects finish as internal failures', async () => {
  const run = await executeWithProgress({ query: 'topic' }, () =>
    Effect.die(new Error('private defect'))
  );

  test.expect(run.error).toBeDefined();
  test.expect(run.events.at(-1)).toEqual({
    type: 'tool-finish',
    toolCallId: 'call',
    toolName: 'sources',
    outcome: 'failure',
    errorKind: 'internal'
  });
});

test.stable(
  'a failed success-preview write never reclassifies completed tool work as a failure',
  async () => {
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

    test.expect(executed).toBe(1);
    test.expect(run.error).toBeDefined();
    test.expect(run.events).toHaveLength(2);
    test.expect(run.events.at(-1)).toMatchObject({ type: 'tool-finish', outcome: 'success' });
  }
);
