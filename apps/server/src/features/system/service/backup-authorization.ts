/** @file Coordinates one interactive authorization without holding the backup scheduler lock. */

import { StudyError, backupSignInIdSchema } from '@study/contracts';
import type { backupOAuthConnectionSchema, backupOAuthInputSchema } from '@study/contracts';
import { normalizeError } from '@study/server';
import type { backupOAuth } from '@study/server';
import { Effect, Schema, Scope } from 'effect';
import type { Semaphore } from 'effect';

type SignInId = typeof backupSignInIdSchema.Type;

type SignIn = ReturnType<ReturnType<typeof backupOAuth>['onedrive']['begin']>;

const inactive = () => new StudyError('cancelled', 'Backup authorization is no longer active');

export function* backupAuthorization<R>(
  oauth: ReturnType<typeof backupOAuth>,
  lock: Semaphore.Semaphore,
  assertMutable: Effect.Effect<void, StudyError>,
  configure: (
    destination: typeof backupOAuthConnectionSchema.Type
  ) => Effect.Effect<void, StudyError, R>
) {
  const scope = yield* Scope.Scope;
  let active:
    | {
        id: SignInId;
        input: typeof backupOAuthInputSchema.Type;
        signIn: SignIn;
        finishing: boolean;
      }
    | undefined;

  function cancel() {
    const previous = active;

    active = undefined;
    previous?.signIn.close();
  }

  yield* Effect.addFinalizer(() => Effect.sync(cancel));

  return {
    cancel,
    operations: {
      beginBackupSignIn: (input: typeof backupOAuthInputSchema.Type) =>
        lock.withPermit(
          Effect.gen(function* () {
            yield* assertMutable;
            cancel();
            const id = Schema.decodeUnknownSync(backupSignInIdSchema)(crypto.randomUUID());
            const signIn = yield* Effect.try({
              try: () =>
                oauth[input.kind].begin(
                  input.clientId,
                  'clientSecret' in input ? input.clientSecret : undefined
                ),
              catch: normalizeError
            });

            active = { id, input, signIn, finishing: false };
            const closed = Effect.callback<void>((resume) => {
              const onClose = () => resume(Effect.void);

              if (signIn.signal.aborted) {
                onClose();

                return;
              }

              signIn.signal.addEventListener('abort', onClose, { once: true });

              return Effect.sync(() => signIn.signal.removeEventListener('abort', onClose));
            });

            yield* Effect.forkIn(
              Effect.race(Effect.sleep('5 minutes'), closed).pipe(
                Effect.andThen(
                  lock.withPermit(
                    Effect.sync(() => {
                      if (active?.id === id) cancel();
                    })
                  )
                )
              ),
              scope
            );

            return { id, url: signIn.url };
          })
        ),
      finishBackupSignIn: Effect.fnUntraced(function* ({ id }: { id: SignInId }) {
        const started = active;

        if (!started || started.id !== id || started.finishing)
          return yield* Effect.fail(inactive());

        started.finishing = true;
        const finish = Effect.gen(function* () {
          const refreshToken = yield* Effect.tryPromise({
            try: (signal) => started.signIn.finish(signal),
            catch: normalizeError
          });

          yield* lock.withPermit(
            Effect.gen(function* () {
              if (active !== started) return yield* Effect.fail(inactive());

              yield* assertMutable;
              yield* configure({ ...started.input, refreshToken });
            })
          );
        });

        yield* finish.pipe(
          Effect.ensuring(
            Effect.sync(() => {
              if (active === started) cancel();
            })
          )
        );
      }),
      cancelBackupSignIn: ({ id }: { id: SignInId }) =>
        lock.withPermit(
          Effect.sync(() => {
            if (active?.id === id) cancel();
          })
        )
    }
  };
}
