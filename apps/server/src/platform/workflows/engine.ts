import { randomUUID } from 'node:crypto';

import { StudyError } from '@study/contracts/errors';
import {
  Context,
  Duration,
  Effect,
  Exit,
  Fiber,
  FiberMap,
  Layer,
  Option,
  Schema,
  Scope
} from 'effect';
import { DurableDeferred, Workflow, WorkflowEngine } from 'effect/workflow';

import type { ServerContext } from '#server/platform/database/context';
import { WorkflowActivityOwner } from '#server/platform/workflows/ownership';
import { workflowStore } from '#server/platform/workflows/store';

const resultCodec = Schema.toCodecJson(
  Workflow.Result({ success: Schema.Unknown, error: Schema.Unknown })
);

const exitCodec = Schema.toCodecJson(Schema.Exit(Schema.Unknown, Schema.Unknown, Schema.Defect()));

const encode = (schema: any, value: unknown) => Schema.encodeSync(schema)(value);

const decode = (schema: any, value: unknown) => Schema.decodeUnknownSync(schema)(value);

const stringify = (value: unknown) => JSON.stringify(value);

// The native engine protocol has no expected error channel for invalid checkpoints.
function checkpoint<A>(read: () => A): Effect.Effect<A> {
  return Effect.try({
    try: read,
    catch: (cause) => new StudyError('internal', 'Invalid workflow checkpoint', { cause })
  }).pipe(Effect.catch(Effect.die));
}

/** A scoped native engine. Durable state lives in the application's SQLite database. */
export function workflowEngineLayer(context: ServerContext) {
  function* makeWorkflowEngine() {
    const scope = yield* Effect.scope;
    const store = workflowStore(context);
    const owners = new WeakMap<WorkflowEngine.WorkflowInstance['Service'], string>();
    const registrations = new Map<
      string,
      {
        workflow: Workflow.AnyWithProps;
        execute: (
          payload: object,
          id: string
        ) => Effect.Effect<
          unknown,
          unknown,
          WorkflowEngine.WorkflowInstance | WorkflowEngine.WorkflowEngine
        >;
        scope: Scope.Scope;
      }
    >();
    const running = yield* FiberMap.make<string, Workflow.Result<unknown, unknown>, never>();
    const interrupted = new Map<string, 'safe' | 'unsafe'>();
    const claims = new Map<string, string>();
    const deferredState = WorkflowEngine.makeDeferredState();
    const lifetimes = new Map<
      string,
      { scope: Scope.Closeable; instances: Set<WorkflowEngine.WorkflowInstance['Service']> }
    >();

    yield* Effect.addFinalizer(() =>
      Effect.gen(function* () {
        for (const lifetime of lifetimes.values())
          for (const instance of lifetime.instances) instance.abandoned = true;

        yield* FiberMap.clear(running);

        for (const lifetime of lifetimes.values()) yield* Scope.close(lifetime.scope, Exit.void);

        for (const [id, owner] of claims) store.release(id, owner);

        claims.clear();
        interrupted.clear();
        lifetimes.clear();
      })
    );
    const codec = (workflow: Workflow.AnyWithProps) =>
      Schema.toCodecJson(
        Workflow.Result({ success: workflow.successSchema, error: workflow.errorSchema })
      );
    const start = Effect.fnUntraced(function* (
      workflow: Workflow.AnyWithProps,
      id: string,
      payload: object
    ) {
      const existing = FiberMap.getUnsafe(running, id);

      if (Option.isSome(existing)) return existing.value;

      const entry = registrations.get(workflow._tag);

      if (!entry)
        return yield* Effect.die(new Error(`Workflow ${workflow._tag} is not registered`));

      const owner = randomUUID();
      const claimed = yield* Effect.sync(() => store.claim(id, owner));

      if (!claimed) return undefined;

      claims.set(id, owner);

      const requested = yield* Effect.sync(() => store.interruptMode(id));

      if (requested) interrupted.set(id, requested);

      let lifetime = lifetimes.get(id);

      if (!lifetime) {
        lifetime = { scope: Scope.makeUnsafe(), instances: new Set() };
        lifetimes.set(id, lifetime);
      }

      const instance = WorkflowEngine.WorkflowInstance.initial(workflow, id, {
        scope: Scope.forkUnsafe(lifetime.scope)
      });

      lifetime.instances.add(instance);
      owners.set(instance, owner);
      const fiber = yield* entry.execute(payload, id).pipe(
        Effect.onExit((exit) => {
          const mode = interrupted.get(id);

          if (!mode) {
            if (Exit.isFailure(exit) && !instance.suspended) instance.abandoned = true;

            return Effect.void;
          }

          if (mode === 'safe' && !instance.suspended && Exit.isSuccess(exit)) return Effect.void;

          instance.interrupted = true;
          instance.suspended = false;

          return Effect.interrupt;
        }),
        Workflow.intoResult,
        Effect.provideService(WorkflowEngine.WorkflowEngine, engine),
        (effect) => deferredState.trackRun(instance, effect),
        Effect.tap((result: Workflow.Result<unknown, unknown>) =>
          Effect.sync(() =>
            store.checkpoint(
              id,
              owner,
              stringify(encode(codec(workflow), result)),
              result._tag === 'Complete'
                ? instance.interrupted
                  ? 'cancelled'
                  : 'completed'
                : 'suspended'
            )
          )
        ),
        Effect.tap((result) => {
          if (result._tag !== 'Complete') return Effect.void;

          lifetimes.delete(id);

          return Scope.close(lifetime.scope, Exit.void);
        }),
        Effect.forkIn(entry.scope)
      );

      FiberMap.setUnsafe(running, id, fiber);
      yield* Effect.gen(function* () {
        while (!fiber.pollUnsafe()) {
          yield* Effect.sleep('10 seconds');
          const mode = store.interruptMode(id);

          if (mode) interrupted.set(id, mode);

          if (!fiber.pollUnsafe() && mode === 'unsafe') {
            yield* Fiber.interrupt(fiber);
            break;
          }

          if (!fiber.pollUnsafe() && !store.renew(id, owner)) {
            instance.abandoned = true;
            yield* Fiber.interrupt(fiber);
            break;
          }
        }
      }).pipe(Effect.forkIn(entry.scope));
      yield* Fiber.await(fiber).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            store.release(id, owner);

            if (claims.get(id) === owner) {
              claims.delete(id);
              interrupted.delete(id);
            }

            owners.delete(instance);
          })
        ),
        Effect.forkIn(entry.scope)
      );

      return fiber;
    });
    const resume = Effect.fnUntraced(function* (workflow: Workflow.Any, id: string) {
      const row = yield* Effect.sync(() => store.execution(id));

      if (!row || row.status === 'completed' || row.status === 'cancelled') return;

      const w = workflow as Workflow.AnyWithProps;
      const payload = yield* checkpoint(
        () => decode(Schema.toCodecJson(w.payloadSchema), JSON.parse(row.payload)) as object
      );

      yield* start(w, id, payload);
    });
    const engine = WorkflowEngine.makeUnsafe({
      register: Effect.fnUntraced(function* (workflow, execute) {
        registrations.set(workflow._tag, {
          workflow: workflow as Workflow.AnyWithProps,
          execute,
          scope: yield* Effect.scope
        });
      }),
      execute: Effect.fnUntraced(function* (workflow, options) {
        const w = workflow as Workflow.AnyWithProps;
        const payload = yield* Effect.sync(() =>
          stringify(encode(Schema.toCodecJson(w.payloadSchema), options.payload))
        );
        const row = yield* Effect.sync(() =>
          store.start(
            options.executionId,
            workflow._tag,
            payload,
            options.detached ? undefined : options.parent?.executionId
          )
        );

        if ((row?.status === 'completed' || row?.status === 'cancelled') && row.result)
          return decode(codec(w), JSON.parse(row.result)) as any;

        const fiber = yield* start(w, options.executionId, options.payload);

        if (options.discard) return undefined as any;

        if (!fiber) return new Workflow.Suspended({}) as any;

        return (yield* Fiber.join(fiber)) as any;
      }),
      poll: (workflow, id) =>
        checkpoint(() => {
          const row = store.execution(id);

          return row?.result && !store.interruptMode(id)
            ? Option.some(
                decode(
                  codec(workflow as Workflow.AnyWithProps),
                  JSON.parse(row.result)
                ) as Workflow.Result<unknown, unknown>
              )
            : Option.none();
        }),
      resume,
      interrupt: (workflow, id) =>
        Effect.gen(function* () {
          yield* Effect.sync(() => store.interrupt(id, 'safe'));

          if (FiberMap.hasUnsafe(running, id)) interrupted.set(id, 'safe');

          yield* resume(workflow, id);
        }),
      interruptUnsafe: (workflow, id) =>
        Effect.gen(function* () {
          yield* Effect.sync(() => store.interrupt(id, 'unsafe'));
          const fiber = FiberMap.getUnsafe(running, id);

          if (Option.isSome(fiber)) {
            interrupted.set(id, 'unsafe');
            yield* Fiber.interrupt(fiber.value);
          }

          yield* resume(workflow, id);
        }),
      activityExecute: Effect.fnUntraced(function* (activity, attempt) {
        const instance = yield* WorkflowEngine.WorkflowInstance;
        const saved = yield* Effect.sync(() =>
          store.activity(instance.executionId, activity.name, attempt)
        );

        if (saved)
          return decode(resultCodec, JSON.parse(saved)) as Workflow.Result<unknown, unknown>;

        if (
          (interrupted.has(instance.executionId) || store.interruptMode(instance.executionId)) &&
          !instance.interrupted
        )
          return new Workflow.Suspended({});

        const child = WorkflowEngine.WorkflowInstance.initial(
          instance.workflow,
          instance.executionId,
          { awaitedDeferreds: instance.awaitedDeferreds }
        );

        child.interrupted = instance.interrupted;
        const owner = owners.get(instance);

        if (!owner) return yield* Effect.die(new Error('Workflow activity lease is unavailable'));

        yield* Effect.sync(() => store.assertOwner(instance.executionId, owner));
        owners.set(child, owner);
        const result = yield* activity.executeEncoded.pipe(
          Workflow.intoResult,
          Effect.provideService(WorkflowEngine.WorkflowInstance, child),
          Effect.provideService(
            WorkflowActivityOwner,
            Object.freeze({
              executionId: instance.executionId,
              ownerToken: owner,
              activityName: activity.name,
              attempt
            })
          )
        );

        if (result._tag === 'Complete')
          yield* Effect.sync(() =>
            store.saveActivity(
              instance.executionId,
              owners.get(instance) ?? '',
              activity.name,
              attempt,
              stringify(encode(resultCodec, result))
            )
          );

        return result;
      }),
      deferredResult: Effect.fnUntraced(function* (deferred) {
        const instance = yield* WorkflowEngine.WorkflowInstance;
        const saved = yield* Effect.sync(() => store.deferred(instance.executionId, deferred.name));

        return saved
          ? Option.some(decode(exitCodec, JSON.parse(saved)) as Exit.Exit<unknown, unknown>)
          : Option.none();
      }),
      deferredDone: (options) =>
        Effect.gen(function* () {
          const caller = yield* Effect.serviceOption(WorkflowEngine.WorkflowInstance);

          const inserted = yield* Effect.sync(() =>
            store.saveDeferred(
              options.executionId,
              options.deferredName,
              stringify(encode(exitCodec, options.exit)),
              Option.isSome(caller)
                ? { id: caller.value.executionId, owner: owners.get(caller.value) ?? '' }
                : undefined
            )
          );

          // A duplicate clock delivery must not preempt work that already passed this wait.
          if (inserted)
            yield* deferredState.deferredDone(options.executionId, options.deferredName);

          const entry = registrations.get(options.workflowName);

          if (entry) yield* resume(entry.workflow, options.executionId);
        }),
      scheduleClock: (workflow, options) =>
        Effect.gen(function* () {
          const caller = yield* Effect.serviceOption(WorkflowEngine.WorkflowInstance);
          const due = BigInt(
            Math.ceil(
              context.clock.currentTimeMillisUnsafe() + Duration.toMillis(options.clock.duration)
            )
          );
          const clock = yield* Effect.sync(() =>
            store.clock(
              options.executionId,
              options.clock.name,
              options.clock.deferred.name,
              due,
              Option.isSome(caller) ? (owners.get(caller.value) ?? '') : ''
            )
          );

          yield* engine
            .deferredDone(options.clock.deferred, {
              workflowName: workflow._tag,
              executionId: options.executionId,
              deferredName: options.clock.deferred.name,
              exit: Exit.void
            })
            .pipe(
              Effect.updateContext((context: Context.Context<never>) =>
                Context.omit(WorkflowEngine.WorkflowInstance)(context)
              ),
              Effect.delay(
                Math.max(0, Number(clock.due_at) - context.clock.currentTimeMillisUnsafe())
              ),
              Effect.tap(() =>
                Effect.sync(() => store.removeClock(options.executionId, options.clock.name))
              ),
              Effect.forkIn(scope)
            );
        })
    });

    return engine;
  }

  return Layer.effect(WorkflowEngine.WorkflowEngine, Effect.gen(makeWorkflowEngine));
}

/** Resume abandoned runs and deliver due clocks from the caller's polling loop. */
export function recoverWorkflowEngine(
  context: ServerContext,
  engine: WorkflowEngine.WorkflowEngine['Service'],
  workflows: readonly Workflow.Any[]
) {
  return Effect.gen(function* () {
    const store = workflowStore(context);
    const byTag = new Map(workflows.map((workflow) => [workflow._tag, workflow]));
    const tags = [...byTag.keys()];
    const clocks = yield* Effect.sync(() => store.dueClocks(tags));

    for (const clock of clocks) {
      const deferred = DurableDeferred.make(clock.deferred_name);

      yield* engine.deferredDone(deferred, {
        workflowName: clock.workflow_tag,
        executionId: clock.execution_id,
        deferredName: clock.deferred_name,
        exit: Exit.void
      });
      yield* Effect.sync(() => store.removeClock(clock.execution_id, clock.name));
    }

    const executions = yield* Effect.sync(() => store.recoverable(tags));

    for (const execution of executions) {
      const workflow = byTag.get(execution.workflow_tag);

      if (workflow) yield* engine.resume(workflow, execution.execution_id);
    }
  }).pipe(Effect.withSpan('workflow.recover'));
}
