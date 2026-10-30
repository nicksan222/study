import { randomUUID } from 'node:crypto';

import { StudyError } from '@study/contracts/errors';
import { Effect, Exit, Option, Scope } from 'effect';

import { AuthGenerationStore, AuthStore } from '#server/features/auth/store/index';
import { acquireSignIn, decodeAccount, encodeAccount } from '#server/platform/ai/auth/index';
import type { Account, SignIn } from '#server/platform/ai/auth/index';
import { ChatGptSession } from '#server/platform/ai/auth/service';
import { Database } from '#server/platform/database/database';
import { defineService } from '#server/platform/definitions/define-service';
import { transaction } from '#server/platform/definitions/define-store';
import { classifyError } from '#server/platform/errors/classify-error';

const same = (a: Account, b: Account) =>
  a.subject === b.subject &&
  a.clientId === b.clientId &&
  a.refreshToken === b.refreshToken &&
  a.sharing === b.sharing &&
  a.email === b.email;

function authFailure(cause: unknown): StudyError {
  if (cause instanceof StudyError) return cause;

  const failure = classifyError(cause);

  return new StudyError(failure.kind, failure.message, {
    cause,
    retryAfterMs: failure.retryAfterMs
  });
}

const cancelled = () => new StudyError('cancelled', 'Sign-in cancelled');

const invalid = (message: string) => new StudyError('invalid_input', message);

const make = Effect.gen(function* () {
  const { store: context } = yield* Database;
  const { manager, issuer, hostId, request } = yield* ChatGptSession;
  const store = AuthStore.make(context);
  const read = () =>
    store
      .findAccount(undefined)
      .pipe(Effect.map((value) => (Option.isSome(value) ? decodeAccount(value.value) : undefined)));
  let active:
    | { id: string; signin: SignIn; scope: Scope.Closeable; finishing: boolean }
    | undefined;
  let generation = 0;
  let closing = false;
  let transition = false;
  const cancel = (id?: string) =>
    Effect.gen(function* () {
      if (id !== undefined && id !== active?.id) return { cancelled: false, version: generation };

      generation++;
      const attempt = active;
      const version = generation;

      active = undefined;

      if (attempt) yield* Scope.close(attempt.scope, Exit.void);

      return { cancelled: true, version };
    });

  yield* Effect.addFinalizer(() =>
    Effect.gen(function* () {
      closing = true;
      yield* cancel();
    })
  );
  const saved = yield* read();

  if (saved) yield* Effect.tryPromise({ try: () => manager.replace(saved), catch: authFailure });

  const status = () =>
    read().pipe(
      Effect.map((account) => ({
        signedIn: !!account,
        email: account?.email ?? null,
        sharing: account?.sharing ?? false
      }))
    );

  return {
    prepareShutdown: () =>
      Effect.gen(function* () {
        closing = true;
        yield* cancel();
      }),
    credentialGeneration: () => AuthGenerationStore.make(context).credentialGeneration(undefined),
    status,
    publicAccount: () =>
      read().pipe(
        Effect.map((account) =>
          account
            ? { subject: account.subject, email: account.email, sharing: account.sharing }
            : undefined
        )
      ),
    startSignIn: (input: { reconsent?: boolean }) =>
      Effect.uninterruptibleMask((restore) =>
        Effect.gen(function* () {
          if (closing) return yield* Effect.fail(cancelled());

          const { version } = yield* cancel();
          const scope = yield* Scope.make();
          const signin = yield* acquireSignIn({
            issuer,
            hostId,
            reconsent: input.reconsent,
            fetch: request
          }).pipe(Scope.provide(scope), Effect.mapError(authFailure));

          return yield* restore(
            Effect.try({
              try: () => {
                if (closing || version !== generation) {
                  throw cancelled();
                }

                const id = randomUUID();

                active = { id, signin, scope, finishing: false };

                return { url: signin.url, attemptId: id };
              },
              catch: authFailure
            })
          ).pipe(
            Effect.onError(() =>
              Effect.gen(function* () {
                if (active?.signin === signin) active = undefined;

                yield* Scope.close(scope, Exit.void);
              })
            )
          );
        })
      ),
    finishSignIn: (input: { attemptId: string }) =>
      Effect.gen(function* () {
        const attempt = active;

        if (!attempt || attempt.id !== input.attemptId)
          return yield* Effect.fail(invalid('Unknown sign-in attempt'));

        if (attempt.finishing) return yield* Effect.fail(invalid('Sign-in is already finishing'));

        attempt.finishing = true;

        return yield* Effect.gen(function* () {
          const result = yield* Effect.tryPromise({
            try: (signal) => attempt.signin.finish(300_000, signal),
            catch: (e) => (closing || active !== attempt ? cancelled() : authFailure(e))
          });

          return yield* Effect.uninterruptibleMask(() =>
            Effect.gen(function* () {
              if (closing || active !== attempt) return yield* Effect.fail(cancelled());

              if (transition) return yield* Effect.fail(invalid('Sign-in transition in progress'));

              transition = true;

              return yield* Effect.gen(function* () {
                const before = yield* read();

                yield* Effect.tryPromise({
                  try: () => manager.replace(result.account, result),
                  catch: authFailure
                });
                const after = yield* read();
                const account =
                  before && after && same(before, result.account) && !same(before, after)
                    ? { ...result.account, refreshToken: after.refreshToken }
                    : result.account;
                const persist = Effect.gen(function* () {
                  if (closing || active !== attempt) return yield* Effect.fail(cancelled());

                  yield* transaction(context, (tx) =>
                    tx.store(AuthStore).saveAccount(encodeAccount(account))
                  );

                  return { signedIn: true, email: account.email ?? null, sharing: account.sharing };
                });

                return yield* persist.pipe(
                  Effect.catch((error) =>
                    Effect.gen(function* () {
                      yield* Effect.tryPromise({
                        try: () => (after ? manager.replace(after) : manager.signOut()),
                        catch: authFailure
                      }).pipe(
                        Effect.catch(() =>
                          Effect.tryPromise({
                            try: () => manager.signOut(),
                            catch: authFailure
                          })
                        )
                      );

                      return yield* Effect.fail(error);
                    })
                  )
                );
              }).pipe(
                Effect.ensuring(
                  Effect.sync(() => {
                    transition = false;
                  })
                )
              );
            })
          );
        }).pipe(
          Effect.ensuring(
            Effect.gen(function* () {
              if (active === attempt) active = undefined;

              yield* Scope.close(attempt.scope, Exit.void);
            })
          )
        );
      }),
    cancelSignIn: (input: { attemptId?: string }) =>
      cancel(input.attemptId).pipe(Effect.map((result) => result.cancelled)),
    signOut: () =>
      Effect.uninterruptibleMask(() =>
        Effect.gen(function* () {
          if (closing || transition)
            return yield* Effect.fail(invalid('Auth transition in progress'));

          yield* cancel();
          transition = true;

          return yield* Effect.gen(function* () {
            yield* Effect.tryPromise({ try: () => manager.signOut(), catch: authFailure });
            const before = yield* read();

            yield* transaction(context, (tx) => tx.store(AuthStore).deleteAccount(undefined)).pipe(
              Effect.catch((error) =>
                Effect.gen(function* () {
                  if (before)
                    yield* Effect.tryPromise({
                      try: () => manager.replace(before),
                      catch: authFailure
                    });

                  return yield* Effect.fail(error);
                })
              )
            );
          }).pipe(
            Effect.ensuring(
              Effect.sync(() => {
                transition = false;
              })
            )
          );
        })
      ),
    rotateRefreshToken: (input: { previous: Account; token: string }) =>
      transaction(context, (tx) => {
        const value = tx.store(AuthStore).findAccount(undefined);
        const saved = Option.isSome(value) ? decodeAccount(value.value) : undefined;

        if (!saved) throw invalid('Sign-in changed during refresh');

        const next = { ...input.previous, refreshToken: input.token };

        if (same(saved, next)) return;

        if (!same(saved, input.previous)) throw invalid('Sign-in changed during refresh');

        tx.store(AuthStore).saveAccount(encodeAccount(next));
      })
  };
});

export const Auth = defineService('study/Auth', make);
