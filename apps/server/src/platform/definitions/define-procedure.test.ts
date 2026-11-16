import { failureSchema, StudyError } from '@study/contracts';
import { workflow_agent_progress } from '@study/db';
import { test } from '@study/testing';
import { Effect, Schema } from 'effect';
import { Workflow, WorkflowEngine } from 'effect/workflow';

import { ServerContext } from '#server/platform/database/context';
import { Database } from '#server/platform/database/database';
import {
  defineProcedure,
  runProcedure,
  procedureTool
} from '#server/platform/definitions/define-procedure';
import { WorkflowConfiguration } from '#server/platform/workflows/configuration';
import { workflowEngineLayer } from '#server/platform/workflows/engine';
import { admitTestExecution } from '#testing/workflow-admission';

test.server.stable(
  'typed procedures nest, validate results, and replay native receipts without repeating work',
  async ({ databases, expect }) => {
    const location = await databases();
    const context = new ServerContext(await location.open());
    let calls = 0;
    const child = defineProcedure({
      id: 'double',
      purpose: 'operation',
      input: Schema.Struct({ value: Schema.Number }),
      output: Schema.Number,
      execute: (input) =>
        Effect.sync(() => {
          calls++;

          return input.value * 2;
        })
    });
    const capability = procedureTool(child, {
      description: 'Double a number',
      mutates: false,
      wiki: { when: 'For arithmetic', examples: ['Double three'], limits: 'One numeric value' }
    });
    const parent = defineProcedure({
      id: 'calculate',
      purpose: 'procedure',
      input: Schema.Number,
      output: Schema.Number,
      execute: (input) =>
        capability.execute(
          { value: input },
          { language: 'english', searchSources: () => Effect.succeed([]) }
        )
    });
    const workflow = Workflow.make('procedure-test', {
      payload: {},
      success: Schema.Number,
      error: failureSchema,
      idempotencyKey: () => 'one'
    });

    try {
      const results = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const engine = yield* WorkflowEngine.WorkflowEngine;

            yield* engine.register(workflow, () =>
              runProcedure(parent, 3, { key: 'root', retry: false })
            );
            admitTestExecution(context, workflow, 'one', {});
            const first = yield* engine.execute(workflow, { executionId: 'one', payload: {} });
            const second = yield* engine.execute(workflow, { executionId: 'one', payload: {} });

            return [first, second];
          }).pipe(
            Effect.provideService(Database, { store: context }),
            Effect.provideService(WorkflowConfiguration, { revision: Effect.succeed('one') }),
            Effect.provide(workflowEngineLayer(context))
          )
        )
      );

      expect(results).toEqual([6, 6]);
      expect(calls).toBe(1);
      const records = context.db.orm.select().from(workflow_agent_progress).all();

      expect(records).toHaveLength(2);
      const traces = records.map((row) => JSON.parse(row.trace!));
      const root = records.find((row) => row.agent_id === 'calculate')!;

      expect(traces.find((trace) => trace.purpose === 'operation').parentRunId).toBe(root.run_id);
      expect(records.every((row) => row.status === 'completed')).toBe(true);
    } finally {
      context.close();
      await location.cleanup();
    }
  }
);

test.server.stable(
  'procedures validate results and preserve canonical failure through parent procedures',
  async ({ databases, expect }) => {
    const location = await databases();
    const context = new ServerContext(await location.open());
    const invalid = defineProcedure({
      id: 'integer',
      purpose: 'operation',
      input: Schema.Number,
      output: Schema.Int,
      execute: (input) => Effect.succeed(input / 2)
    });
    const parent = defineProcedure({
      id: 'parent',
      purpose: 'procedure',
      input: Schema.Number,
      output: Schema.Int,
      execute: (input) => runProcedure(invalid, input, { key: 'integer', retry: false })
    });
    const workflow = Workflow.make('procedure-invalid-result', {
      payload: {},
      success: Schema.Number,
      error: failureSchema,
      idempotencyKey: () => 'one'
    });

    try {
      const error = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const engine = yield* WorkflowEngine.WorkflowEngine;

            yield* engine.register(workflow, () =>
              runProcedure(parent, 3, { key: 'root', retry: false })
            );
            admitTestExecution(context, workflow, 'one', {});

            return yield* engine
              .execute(workflow, { executionId: 'one', payload: {} })
              .pipe(Effect.flip);
          }).pipe(
            Effect.provideService(Database, { store: context }),
            Effect.provideService(WorkflowConfiguration, { revision: Effect.succeed('one') }),
            Effect.provide(workflowEngineLayer(context))
          )
        )
      );

      expect(error.kind).toBe('invalid_input');
      const records = context.db.orm.select().from(workflow_agent_progress).all();

      expect(records).toHaveLength(2);
      expect(records.every((row) => row.failure_kind === 'invalid_input')).toBe(true);
    } finally {
      context.close();
      await location.cleanup();
    }
  }
);

test.server.stable(
  'composite retry reuses completed child receipts with stable tool identity',
  async ({ databases, expect }) => {
    const location = await databases();
    const context = new ServerContext(await location.open());
    let childCalls = 0;
    let attempts = 0;
    const child = defineProcedure({
      id: 'read',
      purpose: 'operation',
      input: Schema.Struct({ value: Schema.Number }),
      output: Schema.Number,
      execute: ({ value }) =>
        Effect.sync(() => {
          childCalls++;

          return value;
        })
    });
    const capability = procedureTool(child, {
      description: 'Read',
      wiki: { when: 'Read', examples: ['Read'], limits: 'One' },
      mutates: false
    });
    const parent = defineProcedure({
      id: 'retry-parent',
      purpose: 'procedure',
      input: Schema.Void,
      output: Schema.Number,
      execute: () =>
        Effect.gen(function* () {
          const value = yield* capability.execute(
            { value: 7 },
            { language: 'english', searchSources: () => Effect.succeed([]) }
          );

          if (attempts++ === 0)
            return yield* Effect.fail(new StudyError('transient', 'Controlled retry'));

          return value;
        })
    });
    const workflow = Workflow.make('procedure-composite-retry', {
      payload: {},
      success: Schema.Number,
      error: failureSchema,
      idempotencyKey: () => 'one'
    });

    try {
      const result = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const engine = yield* WorkflowEngine.WorkflowEngine;

            yield* engine.register(workflow, () =>
              runProcedure(parent, undefined, { key: 'root' })
            );
            admitTestExecution(context, workflow, 'one', {});

            return yield* engine.execute(workflow, { executionId: 'one', payload: {} });
          }).pipe(
            Effect.provideService(Database, { store: context }),
            Effect.provideService(WorkflowConfiguration, { revision: Effect.succeed('one') }),
            Effect.provide(workflowEngineLayer(context))
          )
        )
      );

      expect(result).toBe(7);
      expect(childCalls).toBe(1);
      expect(attempts).toBe(2);
    } finally {
      context.close();
      await location.cleanup();
    }
  }
);

test.server.stable(
  'reusing a scoped call key with different input rejects instead of publishing a stale receipt',
  async ({ databases, expect }) => {
    const location = await databases();
    const context = new ServerContext(await location.open());
    let calls = 0;
    const child = defineProcedure({
      id: 'identity',
      purpose: 'operation',
      input: Schema.Number,
      output: Schema.Number,
      execute: (value) =>
        Effect.sync(() => {
          calls++;

          return value;
        })
    });
    const workflow = Workflow.make('procedure-conflicting-input', {
      payload: {},
      success: Schema.Number,
      error: failureSchema,
      idempotencyKey: () => 'one'
    });
    const conflicting = Effect.gen(function* () {
      yield* runProcedure(child, 1, { key: 'same', retry: false });

      return yield* runProcedure(child, 2, { key: 'same', retry: false });
    });

    try {
      const failure = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const engine = yield* WorkflowEngine.WorkflowEngine;

            yield* engine.register(workflow, () => conflicting);
            admitTestExecution(context, workflow, 'one', {});

            return yield* engine
              .execute(workflow, { executionId: 'one', payload: {} })
              .pipe(Effect.flip);
          }).pipe(
            Effect.provideService(Database, { store: context }),
            Effect.provideService(WorkflowConfiguration, { revision: Effect.succeed('one') }),
            Effect.provide(workflowEngineLayer(context))
          )
        )
      );

      expect(failure.kind).toBe('invalid_input');
      expect(calls).toBe(1);
    } finally {
      context.close();
      await location.cleanup();
    }
  }
);
