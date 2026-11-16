/** @file Owns session within this feature. */

import { StudyError } from '@study/contracts';
import {
  acquireSignIn,
  decodeAccount,
  encodeAccount,
  ChatGptSession,
  transaction,
  useStore
} from '@study/server';
import type { Account, SignIn } from '@study/server';
import { Effect, Exit, Option, Scope } from 'effect';

import { AuthGenerationStore, AuthStore } from '#server/features/auth/store/index';

import { authApiKeyOperations } from './api-keys.ts';
import { authFailure, invalid } from './errors.ts';

const same = (a: Account, b: Account) =>
  a.subject === b.subject &&
  a.clientId === b.clientId &&
  a.refreshToken === b.refreshToken &&
  a.sharing === b.sharing &&
  a.email === b.email;

const cancelled = () => new StudyError('cancelled', 'Sign-in cancelled');

export function* makeAuth() {
  const readAuthGenerationStore = yield* useStore(AuthGenerationStore);

  const { manager, issuer, hostId, request } = yield* ChatGptSession;

  const store = yield* useStore(AuthStore);

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

  const cancel = Effect.fnUntraced(function* (id?: string) {
    if (id !== undefined && id !== active?.id) return { cancelled: false, version: generation };

    generation++;

    const attempt = active;

    const version = generation;

    active = undefined;

    if (attempt) yield* Scope.close(attempt.scope, Exit.void);

    return { cancelled: true, version };
  });

  yield* Effect.addFinalizer(
    Effect.fnUntraced(function* () {
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

  function* signOutAccount() {
    if (closing || transition) return yield* Effect.fail(invalid('Auth transition in progress'));

    yield* cancel();
    transition = true;

    function* removeAccount() {
      yield* Effect.tryPromise({ try: () => manager.signOut(), catch: authFailure });

      const before = yield* read();

      yield* transaction((tx) => tx.store(AuthStore).deleteAccount(undefined)).pipe(
        Effect.catch(
          Effect.fnUntraced(function* (error) {
            if (before)
              yield* Effect.tryPromise({
                try: () => manager.replace(before),
                catch: authFailure
              });

            return yield* Effect.fail(error);
          })
        )
      );
    }

    return yield* Effect.gen(removeAccount).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          transition = false;
        })
      )
    );
  }

  function* finishActiveSignIn(input: { attemptId: string }) {
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

      function* completeSignIn() {
        if (closing || active !== attempt) return yield* Effect.fail(cancelled());

        if (transition) return yield* Effect.fail(invalid('Sign-in transition in progress'));

        transition = true;

        function* replaceAndPersistAccount() {
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

            yield* transaction((tx) => tx.store(AuthStore).saveAccount(encodeAccount(account)));

            return { signedIn: true, email: account.email ?? null, sharing: account.sharing };
          });

          function* restorePreviousAccount(error: StudyError) {
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
          }

          return yield* persist.pipe(
            Effect.catch((error) => Effect.gen(() => restorePreviousAccount(error)))
          );
        }

        return yield* Effect.gen(replaceAndPersistAccount).pipe(
          Effect.ensuring(
            Effect.sync(() => {
              transition = false;
            })
          )
        );
      }

      return yield* Effect.uninterruptibleMask(() => Effect.gen(completeSignIn));
    }).pipe(
      Effect.ensuring(
        Effect.gen(function* () {
          if (active === attempt) active = undefined;

          yield* Scope.close(attempt.scope, Exit.void);
        })
      )
    );
  }

  return {
    prepareShutdown: Effect.fnUntraced(function* () {
      closing = true;
      yield* cancel();
    }),
    credentialGeneration: () => readAuthGenerationStore.credentialGeneration(undefined),
    status,
    publicAccount: () =>
      read().pipe(
        Effect.map((account) =>
          account
            ? { subject: account.subject, email: account.email, sharing: account.sharing }
            : undefined
        )
      ),
    startSignIn: (input: { reconsent?: boolean; callbackUrl?: string }) =>
      Effect.uninterruptibleMask(
        Effect.fnUntraced(function* (restore) {
          if (closing) return yield* Effect.fail(cancelled());

          const { version } = yield* cancel();

          const resolvedHostId =
            hostId ?? (yield* transaction((tx) => tx.store(AuthStore).ensureHostId(undefined)));
          const scope = yield* Scope.make();

          const signin = yield* acquireSignIn({
            issuer,
            callbackUrl: input.callbackUrl,
            hostId: resolvedHostId,
            reconsent: input.reconsent,
            fetch: request
          }).pipe(Scope.provide(scope), Effect.mapError(authFailure));

          function* closeFailedSignIn() {
            if (active?.signin === signin) active = undefined;

            yield* Scope.close(scope, Exit.void);
          }

          return yield* restore(
            Effect.try({
              try: () => {
                if (closing || version !== generation) {
                  throw cancelled();
                }

                const id = crypto.randomUUID();

                active = { id, signin, scope, finishing: false };

                return { url: signin.url, attemptId: id };
              },
              catch: authFailure
            })
          ).pipe(Effect.onError(() => Effect.gen(closeFailedSignIn)));
        })
      ),
    receiveSignInCallback: (input: { search: string }) =>
      Effect.sync(() => {
        const signin: SignIn | undefined = active?.signin;

        return signin?.acceptCallback(new URLSearchParams(input.search)) ?? false;
      }),
    finishSignIn: (input: { attemptId: string }) => Effect.gen(() => finishActiveSignIn(input)),
    cancelSignIn: (input: { attemptId?: string }) =>
      cancel(input.attemptId).pipe(Effect.map((result) => result.cancelled)),
    signOut: () => Effect.uninterruptibleMask(() => Effect.gen(signOutAccount)),
    rotateRefreshToken: (input: { previous: Account; token: string }) =>
      transaction((tx) => {
        const value = tx.store(AuthStore).findAccount(undefined);

        const saved = Option.isSome(value) ? decodeAccount(value.value) : undefined;

        if (!saved) throw invalid('Sign-in changed during refresh');

        const next = { ...input.previous, refreshToken: input.token };

        if (same(saved, next)) return;

        if (!same(saved, input.previous)) throw invalid('Sign-in changed during refresh');

        tx.store(AuthStore).saveAccount(encodeAccount(next));
      }),
    ...(yield* authApiKeyOperations())
  };
}
