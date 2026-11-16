import { sourceIndexedSchema, sourceDeletedSchema, workflowEventSchema } from '@study/contracts';
/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Tests typed workflow registration, event subscriptions, and native execution       │
 * │ against SQLite-backed workflow infrastructure. Compile-time assertions check payload,    │
 * │ result, error, and trigger compatibility.                                                │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Asserts: registration retains native definition, derived version and independent       │
 * │   subscriptions; registered subscriptions retain disabled events and recover native      │
 * │   executions after reopen.                                                               │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Uses #server/platform/database/context, #server/platform/definitions/define-workflow,    │
 * │ #server/platform/definitions/define-workflow-handler with real SQLite and application    │
 * │ resources; fixture cleanup closes owned resources.                                       │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */
import { workflowReceipts } from '@study/db';
import { test } from '@study/testing';
import { Context, Effect, Schema } from 'effect';
import type { Scope, Layer } from 'effect';
import type { Workflow } from 'effect/workflow';
import type { WorkflowEngine } from 'effect/workflow';

import { ServerContext } from '#server/platform/database/context';
import { Database } from '#server/platform/database/database';
import { defineWorkflow } from '#server/platform/definitions/define-workflow';
import { defineWorkflowHandler } from '#server/platform/definitions/define-workflow-handler';
import { workflowEngineLayer } from '#server/platform/workflows/engine';
import { dispatchPending } from '#server/platform/workflows/triggers';

const workflow = defineWorkflow({
  name: 'test-registration',
  version: 3,
  payload: Schema.Struct({ event: workflowEventSchema }),
  success: Schema.Void,
  error: Schema.Never,
  idempotencyKey: ({ event }) => event.eventId
});

test.stable(
  'registration retains native definition, derived version and independent subscriptions',
  () => {
    let enabled = false;
    let calls = 0;
    const policy = () => {
      calls++;

      return enabled;
    };
    const registration = defineWorkflowHandler(workflow, {
      execute: () => Effect.void,
      triggers: [
        { subscription: 'test-a', event: 'SourceIndexed', emits: [], enabled: policy },
        { subscription: 'test-b', event: 'SourceDeleted', emits: ['SourceIndexed'] }
      ]
    });

    test.assert.strictEqual(registration.definition, workflow);
    test.assert.strictEqual(calls, 0);
    test.assert.strictEqual(registration.triggers[0]!.workflow, workflow);
    test.assert.strictEqual(registration.triggers[0]!.workflowVersion, 3);
    test.assert.ok(registration.triggers[0]!.subscription === 'test-a');
    test.assert.ok(registration.triggers[1]!.subscription === 'test-b');
    test.expect(registration.triggers[1]!.emits).toStrictEqual(['SourceIndexed']);
    test.assert.ok(registration.triggers[0]!.enabled() === false);
    enabled = true;
    test.assert.ok(registration.triggers[0]!.enabled() === true);
    test.assert.strictEqual(calls, 2);
    test.assert.ok(registration.triggers[1]!.enabled() === true);
  }
);

class Requirement extends Context.Service<Requirement, string>()('test/WorkflowRequirement') {}

class Decoding extends Context.Service<Decoding, string>()('test/WorkflowDecoding') {}

class Encoding extends Context.Service<Encoding, string>()('test/WorkflowEncoding') {}

function typeAssertions() {
  const narrowed = defineWorkflow({
    name: 'test-narrow-registration',
    version: 2,
    payload: Schema.Struct({ event: sourceIndexedSchema }),
    success: Schema.String,
    error: Schema.String,
    idempotencyKey: ({ event }) => event.eventId
  });
  const valid = { subscription: 'typed', event: 'SourceIndexed', emits: [] } as const;

  defineWorkflowHandler(narrowed, {
    // @ts-expect-error payload must match the canonical workflow
    execute: (_payload: number) => Effect.succeed(''),
    triggers: [valid]
  });
  defineWorkflowHandler(narrowed, {
    // @ts-expect-error success must match the native schema
    execute: () => Effect.succeed(1),
    triggers: [valid]
  });
  defineWorkflowHandler(narrowed, {
    // @ts-expect-error errors must match the native schema
    execute: () => Effect.fail(1),
    triggers: [valid]
  });
  defineWorkflowHandler(narrowed, {
    execute: () => Effect.succeed(''),
    // @ts-expect-error a deleted event cannot populate the indexed payload
    triggers: [{ ...valid, event: 'SourceDeleted' }]
  });
  defineWorkflowHandler(narrowed, {
    execute: () => Effect.succeed(''),
    // @ts-expect-error enabled policies return booleans synchronously
    triggers: [{ ...valid, enabled: async () => true }]
  });
  const incompatibleUnion: 'SourceIndexed' | 'SourceDeleted' =
    Math.random() > 0.5 ? 'SourceIndexed' : 'SourceDeleted';

  defineWorkflowHandler(narrowed, {
    execute: () => Effect.succeed(''),
    // @ts-expect-error every event in a subscription union must fit the payload
    triggers: [{ ...valid, event: incompatibleUnion }]
  });
  const union = defineWorkflow({
    name: 'test-union-registration',
    version: 1,
    payload: Schema.Struct({ event: Schema.Union([sourceIndexedSchema, sourceDeletedSchema]) }),
    success: Schema.Void,
    error: Schema.Never,
    idempotencyKey: ({ event }) => event.eventId
  });

  defineWorkflowHandler(union, {
    execute: () => Effect.void,
    triggers: [{ ...valid, event: incompatibleUnion }]
  });
  const extraPayload = defineWorkflow({
    name: 'test-required-input',
    version: 1,
    payload: Schema.Struct({ event: sourceIndexedSchema, required: Schema.String }),
    success: Schema.Void,
    error: Schema.Never,
    idempotencyKey: ({ event }) => event.eventId
  });

  defineWorkflowHandler(extraPayload, {
    execute: () => Effect.void,
    // @ts-expect-error dispatch only supplies the event, not additional required fields
    triggers: [valid]
  });
  const codec = Schema.String as Schema.Codec<string, string, Decoding, Encoding>;
  const codecWorkflow = defineWorkflow({
    name: 'test-codec-services',
    version: 1,
    payload: Schema.Struct({ id: codec }),
    success: codec,
    error: codec,
    idempotencyKey: ({ id }) => id
  });
  const codecRegistration = defineWorkflowHandler(codecWorkflow, {
    execute: ({ id }) => Effect.succeed(id),
    triggers: []
  });
  const codecExact: Layer.Layer<
    never,
    never,
    Database | WorkflowEngine.WorkflowEngine | Decoding | Encoding
  > = codecRegistration.layer;
  // @ts-expect-error encoding services are retained by native registration
  const missingEncoding: Layer.Layer<
    never,
    never,
    Database | WorkflowEngine.WorkflowEngine | Decoding
  > = codecRegistration.layer;
  // @ts-expect-error decoding services are retained by native registration
  const missingDecoding: Layer.Layer<
    never,
    never,
    Database | WorkflowEngine.WorkflowEngine | Encoding
  > = codecRegistration.layer;
  const execute = () =>
    Effect.void as Effect.Effect<
      void,
      never,
      | Requirement
      | Scope.Scope
      | WorkflowEngine.WorkflowEngine
      | WorkflowEngine.WorkflowInstance
      | Workflow.Execution<typeof workflow._tag>
    >;
  const native = workflow.toLayer(execute);
  const registration = defineWorkflowHandler(workflow, { execute, triggers: [] });
  const exact: Layer.Layer<
    never,
    never,
    Database | Database | Requirement | WorkflowEngine.WorkflowEngine
  > = registration.layer;
  const reverse: typeof registration.layer = native;
  const nativeRequirements: Layer.Layer<
    never,
    never,
    Database | Requirement | WorkflowEngine.WorkflowEngine
  > = registration.layer;
  // @ts-expect-error application dependencies remain required
  const missingRequirement: Layer.Layer<never, never, WorkflowEngine.WorkflowEngine> =
    registration.layer;

  // @ts-expect-error metadata is immutable
  workflow.version = 4;

  return {
    exact,
    reverse,
    nativeRequirements,
    missingRequirement,
    codecExact,
    missingEncoding,
    missingDecoding
  };
}

void typeAssertions;

const event = (id: string) =>
  Schema.decodeUnknownSync(workflowEventSchema)({
    type: 'SourceIndexed',
    eventId: id,
    causationId: null,
    correlationId: id,
    inputVersion: 1,
    depth: 0,
    projectId: 1n,
    sourceId: 2n,
    documentId: 3n
  });

test.stable(
  'registration preserves dispatch duplicate subscription and synchronous policy validation',
  async ({ databases }) => {
    const location = await databases();
    const context = new ServerContext(await location.open());
    const subscription = { subscription: 'duplicate', event: 'SourceIndexed', emits: [] } as const;
    const duplicates = defineWorkflowHandler(workflow, {
      execute: () => Effect.void,
      triggers: [subscription, subscription]
    });
    const asynchronous = defineWorkflowHandler(workflow, {
      execute: () => Effect.void,
      triggers: [
        {
          ...subscription,
          enabled: () => Promise.resolve(true) as unknown as boolean
        }
      ]
    });

    try {
      await test
        .expect(
          Effect.runPromise(
            dispatchPending(context, duplicates.triggers, 1).pipe(
              Effect.provide(workflowEngineLayer(context))
            )
          )
        )
        .rejects.toThrow('duplicate subscription');
      await test
        .expect(
          Effect.runPromise(
            dispatchPending(context, asynchronous.triggers, 1).pipe(
              Effect.provide(workflowEngineLayer(context))
            )
          )
        )
        .rejects.toThrow('boolean synchronously');
      test.assert.strictEqual(context.db.orm.select().from(workflowReceipts).all().length, 0);
    } finally {
      context.close();
      await location.cleanup();
    }
  }
);

test.stable(
  'reused registrations resolve each engine environment and preserve execution scopes',
  async ({ databases }) => {
    const observed: string[] = [];
    let releases = 0;
    const release = Effect.sync(() => {
      releases++;
    });
    const registration = defineWorkflowHandler(workflow, {
      execute: () =>
        Effect.gen(function* () {
          const value = yield* Requirement;

          yield* Effect.acquireRelease(Effect.void, () => release);
          observed.push(value);
        }),
      triggers: []
    });

    for (const value of ['first', 'second']) {
      const location = await databases();
      const context = new ServerContext(await location.open());

      try {
        await Effect.runPromise(
          Effect.scoped(
            workflow
              .execute({ event: event(value) })
              .pipe(
                Effect.provide(registration.layer),
                Effect.provideService(Database, { store: context }),
                Effect.provideService(Requirement, value),
                Effect.provide(workflowEngineLayer(context))
              )
          )
        );
      } finally {
        context.close();
        await location.cleanup();
      }
    }

    test.expect(observed).toStrictEqual(['first', 'second']);
    test.assert.strictEqual(releases, 2);
  }
);
