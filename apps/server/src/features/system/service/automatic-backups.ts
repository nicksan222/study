/** @file Owns the daily schedule and serializes backup delivery and destination changes. */

import { StudyError, backupIdSchema, MAX_AUTOMATIC_BACKUPS } from '@study/contracts';
import type { automaticBackupConfigurationSchema } from '@study/contracts';
import { BackupStorage } from '@study/server';
import type { ManagedBackups } from '@study/server';
import { Clock, Effect, Option, Schema } from 'effect';
import type { Semaphore, Result } from 'effect';

import { Settings } from '#server/features/settings/index';

import { backupAuthorization } from './backup-authorization.ts';
import { createBackupStrategies } from './backup/registry.ts';
import { backupAttempt } from './backup/strategy.ts';

const day = 24 * 60 * 60_000;

const retryDelay = 5 * 60_000;

type AutomaticBackupState = Parameters<(typeof Settings)['Service']['saveAutomaticBackupState']>[0];

type Destination = AutomaticBackupState['destination'];

const offStatus = {
  destination: 'off',
  path: null,
  lastSuccessAtMs: null,
  lastFailure: null
} as const;

function due(state: AutomaticBackupState, now: number) {
  return (
    state.lastFailure !== 'auth' &&
    now >= state.retryAtMs &&
    (state.lastSuccessAtMs === null || now >= state.lastSuccessAtMs + day)
  );
}

const restorePendingError = () =>
  new StudyError('invalid_input', 'Finish the pending restore first');

export function* automaticBackupOperations(lock: Semaphore.Semaphore) {
  const storage = yield* BackupStorage;
  const owner: ManagedBackups = storage.owner;
  const settings = yield* Settings;
  const read = () => settings.automaticBackupState().pipe(Effect.map(Option.getOrUndefined));
  const persist = settings.saveAutomaticBackupState;
  const strategies = createBackupStrategies<Effect.Services<ReturnType<typeof persist>>>(
    owner,
    storage.request
  );
  const pendingRestore = backupAttempt(() => owner.restorePending());
  const assertMutable = pendingRestore.pipe(
    Effect.flatMap((pending) => (pending ? Effect.fail(restorePendingError()) : Effect.void))
  );

  const configure = Effect.fnUntraced(function* (destination: Destination) {
    const state = yield* read();

    yield* persist({
      destination,
      installation:
        state?.installation ?? Schema.decodeUnknownSync(backupIdSchema)(crypto.randomUUID()),
      nextSlot: state?.nextSlot ?? 0,
      lastSuccessAtMs: null,
      lastFailure: null,
      retryAtMs: 0
    });
  });

  const authorization = yield* backupAuthorization(
    strategies.oauth,
    lock,
    assertMutable,
    configure
  );

  function deliver(state: AutomaticBackupState, destination: NonNullable<Destination>) {
    const name = `Study-${state.installation}-${state.nextSlot + 1}.studybackup`;
    const { pendingObjectId, ...current } = state;

    return backupAttempt(() => owner.automaticSnapshot()).pipe(
      Effect.flatMap((bytes) =>
        strategies.publish(destination, {
          name,
          bytes,
          pendingObjectId,
          checkpoint: (connection, objectId) =>
            persist({
              ...current,
              destination: connection,
              ...(objectId ? { pendingObjectId: objectId } : {})
            })
        })
      )
    );
  }

  const recordDelivery = Effect.fnUntraced(function* (
    state: AutomaticBackupState,
    result: Result.Result<void, StudyError>
  ) {
    const latest = (yield* read()) ?? state;
    const finished = yield* Clock.currentTimeMillis;

    if (result._tag === 'Failure') {
      yield* persist({
        ...latest,
        lastFailure: result.failure.kind,
        retryAtMs: finished + Math.max(retryDelay, result.failure.retryAfterMs ?? 0)
      });

      return;
    }

    const { pendingObjectId: _pending, ...completed } = latest;

    yield* persist({
      ...completed,
      nextSlot: (state.nextSlot + 1) % MAX_AUTOMATIC_BACKUPS,
      lastSuccessAtMs: finished,
      lastFailure: null,
      retryAtMs: 0
    });
  });

  function run(force: boolean) {
    return lock.withPermit(
      Effect.gen(function* () {
        const state = yield* read();
        const now = yield* Clock.currentTimeMillis;

        if (!state?.destination) {
          if (force) yield* Effect.fail(new StudyError('config', 'Enable automatic backups first'));

          return;
        }

        if (!force && !due(state, now)) return;

        if (yield* pendingRestore) {
          if (force) yield* Effect.fail(restorePendingError());

          return;
        }

        const result = yield* Effect.result(deliver(state, state.destination));

        yield* recordDelivery(state, result);

        if (force && result._tag === 'Failure') yield* Effect.fail(result.failure);
      })
    );
  }

  return {
    automaticBackup: Effect.fnUntraced(function* () {
      const state = yield* read();

      if (!state?.destination) return offStatus;

      const { destination, lastSuccessAtMs, lastFailure } = state;

      return {
        destination: destination.kind,
        path: strategies.location(destination),
        lastSuccessAtMs,
        lastFailure
      };
    }),
    configureAutomaticBackup: (input: typeof automaticBackupConfigurationSchema.Type) =>
      lock.withPermit(
        Effect.gen(function* () {
          yield* assertMutable;
          const destination = input.kind === 'off' ? null : yield* strategies.prepare(input);

          authorization.cancel();
          yield* configure(destination);
        })
      ),
    runAutomaticBackup: () => run(true),
    scheduledBackup: () => run(false),
    ...authorization.operations
  };
}
