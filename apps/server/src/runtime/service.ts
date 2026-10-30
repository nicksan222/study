import { StudyError } from '@study/contracts/errors';
import { Cause, Clock, Effect, Exit, Queue, Scope } from 'effect';

import { Auth } from '#server/features/auth/index';
import { AuthManager } from '#server/platform/ai/auth/index';
import { ServerContext } from '#server/platform/database/context';

import { createNativeRuntime, runNative } from './layers.ts';
import { nativeLayers } from './native.ts';
import { Workers } from './workers.ts';

/** Owns the database, native services, and workflow consumer for one application. */
export class App {
  readonly shutdown = new AbortController();
  private closing?: Promise<void>;

  readonly store: ServerContext;
  private readonly auth: AuthManager;
  readonly native: ReturnType<typeof nativeLayers>;
  readonly nativeRuntime: ReturnType<typeof createNativeRuntime>;
  readonly workers: Workers;
  private readonly scope: Scope.Closeable;

  private constructor(
    store: ServerContext,
    auth: AuthManager,
    native: ReturnType<typeof nativeLayers>,
    nativeRuntime: ReturnType<typeof createNativeRuntime>,
    workers: Workers,
    scope: Scope.Closeable
  ) {
    this.store = store;
    this.auth = auth;
    this.native = native;
    this.nativeRuntime = nativeRuntime;
    this.workers = workers;
    this.scope = scope;
  }

  static open(options: {
    path: string;
    issuer?: string;
    hostId?: string;
    fetch?: typeof fetch;
  }): Promise<App> {
    const issuer = options.issuer ?? 'https://auth.openai.com';

    function* openScope(
      restore: <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>
    ) {
      const scope = yield* Scope.make();

      function* acquireApplication() {
        let runtime: ReturnType<typeof createNativeRuntime> | undefined;
        const clock = yield* Clock.Clock;
        const auth = yield* Effect.acquireRelease(
          Effect.try({
            try: () =>
              new AuthManager({
                issuer,
                clock,
                fetch: options.fetch,
                saveRefresh: async (previous, token) => {
                  if (!runtime) throw new StudyError('internal', 'Application is not initialized');

                  await runtime.runPromise(
                    Effect.flatMap(Auth, (account) =>
                      account.rotateRefreshToken({ previous, token })
                    )
                  );
                }
              }),
            catch: (cause) => cause
          }),
          (owner) =>
            Effect.tryPromise({
              try: () => owner.dispose(),
              catch: (error) => error
            }).pipe(Effect.orDie)
        );
        const store = yield* Effect.acquireRelease(
          Effect.try({
            try: () => ServerContext.open(options.path, clock),
            catch: (cause) => cause
          }),
          (context) => Effect.sync(() => context.close())
        );
        const queue = yield* Queue.sliding<void>(1);
        let workers: Workers;
        const native = nativeLayers(
          store,
          auth,
          issuer,
          options.hostId ?? 'study',
          {
            started: Effect.sync(() => workers.started),
            start: Effect.tryPromise({
              try: () => workers.start(),
              catch: (cause) =>
                cause instanceof StudyError
                  ? cause
                  : new StudyError('internal', 'Workflow worker could not start', {
                      cause
                    })
            }),
            stop: Effect.tryPromise({
              try: () => workers.stop(),
              catch: (cause) =>
                cause instanceof StudyError
                  ? cause
                  : new StudyError('internal', 'Workflow worker could not stop', {
                      cause
                    })
            })
          },
          {
            cancel: (input) =>
              Effect.tryPromise({
                try: () => workers.cancelExecution(input),
                catch: (cause) =>
                  cause instanceof StudyError
                    ? cause
                    : new StudyError('internal', 'Workflow cancellation failed', {
                        cause
                      })
              })
          },
          options.fetch
        );

        runtime = yield* Effect.acquireRelease(
          Effect.sync(() => createNativeRuntime(native)),
          (owner) =>
            Effect.tryPromise({
              try: () => owner.dispose(),
              catch: (error) => error
            }).pipe(Effect.orDie)
        );
        // On failed acquisition, flush auth while the runtime and database still exist.
        yield* Scope.addFinalizer(
          scope,
          Effect.tryPromise({ try: () => auth.dispose(), catch: (error) => error }).pipe(
            Effect.orDie
          )
        );
        workers = yield* Effect.acquireRelease(
          Effect.sync(() => new Workers(store, native, runtime!, queue)),
          (owner) =>
            Effect.tryPromise({ try: () => owner.close(), catch: (error) => error }).pipe(
              Effect.orDie
            )
        );
        yield* Effect.tryPromise({
          try: () => runtime!.context(),
          catch: (cause) => cause
        });

        return new App(store, auth, native, runtime, workers, scope);
      }

      const result = yield* Effect.exit(
        restore(Scope.provide(Effect.gen(acquireApplication), scope))
      );

      if (Exit.isFailure(result)) {
        const cleanup = yield* Effect.exit(Scope.close(scope, result));

        return yield* Effect.failCause(
          Exit.isFailure(cleanup) ? Cause.combine(result.cause, cleanup.cause) : result.cause
        );
      }

      return result.value;
    }

    return runNative(Effect.uninterruptibleMask((restore) => Effect.gen(() => openScope(restore))));
  }

  close(): Promise<void> {
    if (this.closing) return this.closing;

    const stopped = this.workers.close();
    const closing = Promise.resolve().then(() => this.release(stopped));

    this.closing = closing;
    this.shutdown.abort();
    void closing.catch(() => {
      if (this.closing === closing) this.closing = undefined;
    });

    return closing;
  }

  private async release(stopped: Promise<void>) {
    const errors: unknown[] = [];

    try {
      await stopped;
    } catch (error) {
      errors.push(error);
    }

    try {
      await this.nativeRuntime.runPromise(Effect.flatMap(Auth, (auth) => auth.prepareShutdown()));
    } catch (error) {
      errors.push(error);
    }

    // Refresh persistence calls the Auth service, so its runtime and SQLite must remain alive.
    try {
      await this.auth.dispose();
    } catch (error) {
      errors.push(error);

      throw new AggregateError(
        errors,
        'Credential cleanup failed; application close can be retried'
      );
    }

    try {
      await runNative(Scope.close(this.scope, Exit.void));
    } catch (error) {
      errors.push(error);
    }

    if (errors.length) throw new AggregateError(errors, 'Application cleanup failed');
  }

  subscribe(listener: () => void) {
    return this.store.subscribe(listener);
  }
}
