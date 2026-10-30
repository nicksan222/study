import { StudyError } from '@study/contracts/errors';
import type { cancelExecutionInputSchema } from '@study/contracts/workflows/schemas';
import { Cause, Effect, Fiber, Queue, Semaphore } from 'effect';
import { WorkflowEngine } from 'effect/workflow';

import type { ServerContext } from '#server/platform/database/context';
import { classifyError } from '#server/platform/errors/classify-error';
import { observeOperation, safeMetadata } from '#server/platform/observability/index';
import {
  WorkflowConfiguration,
  notifyConfigurationChanged
} from '#server/platform/workflows/configuration';
import { cancelExecution } from '#server/platform/workflows/control';
import { recoverWorkflowEngine } from '#server/platform/workflows/engine';
import { dispatchPending } from '#server/platform/workflows/triggers';

import { createWorkflowRuntime } from './layers.ts';
import type { createNativeRuntime } from './layers.ts';
import type { nativeLayers } from './native.ts';
import { workflowDefinitions, workflowTriggers } from './workflows.ts';

type Consumer = {
  readonly runtime: ReturnType<typeof createWorkflowRuntime>;
  readonly fiber: Fiber.Fiber<void, unknown>;
  readonly unsubscribe: () => void;
};

type Lifecycle =
  | { readonly tag: 'stopped' }
  | { readonly tag: 'running'; readonly consumer: Consumer }
  | { readonly tag: 'stopping' }
  | { readonly tag: 'closing'; readonly consumer: Consumer | undefined }
  | { readonly tag: 'closed' };

/** One scoped durable workflow consumer; committed hints only accelerate polling. */
export class Workers {
  private readonly runtime: ReturnType<typeof createNativeRuntime>;
  private readonly layers: ReturnType<typeof nativeLayers>;
  private readonly queue: Queue.Queue<void>;
  private readonly store: ServerContext;
  private readonly transitions = Semaphore.makeUnsafe(1);
  private state: Lifecycle = { tag: 'stopped' };

  constructor(
    store: ServerContext,
    layers: ReturnType<typeof nativeLayers>,
    runtime: ReturnType<typeof createNativeRuntime>,
    queue: Queue.Queue<void>
  ) {
    this.store = store;
    this.runtime = runtime;
    this.queue = queue;
    this.layers = layers;
  }

  get started() {
    return this.state.tag === 'running';
  }

  private transition<A, E>(effect: Effect.Effect<A, E>): Promise<A> {
    return this.runtime.runPromise(
      this.transitions.withPermit(Effect.uninterruptibleMask(() => effect))
    );
  }

  start(): Promise<void> {
    return this.transition(
      Effect.sync(() => {
        if (this.state.tag === 'closing' || this.state.tag === 'closed')
          throw new StudyError('cancelled', 'Workflow worker is closing');

        if (this.state.tag === 'stopped')
          this.state = { tag: 'running', consumer: this.startConsumer() };
      })
    );
  }

  private startConsumer(): Consumer {
    const unsubscribe = this.store.subscribe(() => this.wake());
    const store = this.store;
    const queue = this.queue;

    const runtime = createWorkflowRuntime(this.layers, this.runtime);
    const fiber = runtime.runFork(
      Effect.gen(function* () {
        const engine = yield* WorkflowEngine.WorkflowEngine;
        const configuration = yield* WorkflowConfiguration;

        const tick = observeOperation(
          'workflow.tick',
          Effect.gen(function* () {
            yield* Effect.try(() =>
              dispatchPending(store, workflowTriggers, store.clock.currentTimeMillisUnsafe())
            );
            const revision = yield* configuration.revision;

            yield* notifyConfigurationChanged(store, engine, revision);
            yield* recoverWorkflowEngine(store, engine, workflowDefinitions);
          })
        );

        while (true) {
          yield* tick.pipe(
            Effect.catchCause((cause) =>
              Cause.hasInterrupts(cause)
                ? Effect.failCause(cause)
                : Effect.logError('Workflow recovery failed').pipe(
                    Effect.annotateLogs(
                      safeMetadata({
                        operation: 'workflow.tick',
                        errorKind: classifyError(Cause.squash(cause)).kind
                      })
                    )
                  )
            )
          );
          yield* Queue.take(queue).pipe(Effect.timeoutOption('250 millis'));
        }
      }).pipe(Effect.asVoid)
    );

    return { runtime, fiber, unsubscribe };
  }

  cancelExecution(input: typeof cancelExecutionInputSchema.Type): Promise<void> {
    return this.transition(
      Effect.gen({ self: this }, function* () {
        if (this.state.tag === 'closing' || this.state.tag === 'closed')
          return yield* Effect.fail(new StudyError('cancelled', 'Workflow worker is closing'));

        const active = this.state.tag === 'running' ? this.state.consumer.runtime : undefined;
        const runtime = active ?? createWorkflowRuntime(this.layers, this.runtime);

        return yield* Effect.tryPromise({
          try: () => runtime.runPromise(cancelExecution(this.store, workflowDefinitions, input)),
          catch: (error) => error
        }).pipe(
          Effect.ensuring(
            active
              ? Effect.void
              : Effect.tryPromise({ try: () => runtime.dispose(), catch: (error) => error }).pipe(
                  Effect.orDie
                )
          )
        );
      })
    );
  }

  wake() {
    Queue.offerUnsafe(this.queue, undefined);
  }

  stop(): Promise<void> {
    return this.transition(
      Effect.gen({ self: this }, function* () {
        if (this.state.tag !== 'running') return;

        const consumer = this.state.consumer;

        this.state = { tag: 'stopping' };
        yield* this.disposeConsumer(consumer).pipe(
          Effect.ensuring(
            Effect.sync(() => {
              if (this.state.tag === 'stopping') this.state = { tag: 'stopped' };
            })
          )
        );
      })
    );
  }

  close(): Promise<void> {
    if (this.state.tag !== 'closing' && this.state.tag !== 'closed')
      this.state = {
        tag: 'closing',
        consumer: this.state.tag === 'running' ? this.state.consumer : undefined
      };

    return this.transition(
      Effect.gen({ self: this }, function* () {
        if (this.state.tag !== 'closing') return;

        const consumer = this.state.consumer;

        yield* (consumer ? this.disposeConsumer(consumer) : Effect.void).pipe(
          Effect.ensuring(
            Effect.sync(() => {
              this.state = { tag: 'closed' };
            })
          )
        );
      })
    );
  }

  private disposeConsumer(consumer: Consumer) {
    return Effect.gen(function* () {
      const errors: unknown[] = [];

      try {
        consumer.unsubscribe();
      } catch (error) {
        errors.push(error);
      }

      const interruption = yield* Effect.exit(Fiber.interrupt(consumer.fiber));

      if (interruption._tag === 'Failure') errors.push(Cause.squash(interruption.cause));

      yield* Effect.tryPromise({
        try: () => consumer.runtime.dispose(),
        catch: (error) => error
      }).pipe(
        Effect.catch((error) =>
          Effect.sync(() => {
            errors.push(error);
          })
        )
      );

      if (errors.length)
        return yield* Effect.fail(new AggregateError(errors, 'Workflow worker cleanup failed'));
    });
  }
}
