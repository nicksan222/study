/** @file Refreshes OAuth access and checkpoints provider state before publishing a slot. */

import { StudyError } from '@study/contracts';
import type { backupOAuthConnectionSchema } from '@study/contracts';
import type { backupOAuth } from '@study/server';
import { Effect } from 'effect';

import { backupAttempt } from './strategy.ts';
import type { BackupSlot, BackupStrategy } from './strategy.ts';

type OAuth = ReturnType<typeof backupOAuth>;

function* publishDriveBackup<R>(
  provider: OAuth['google-drive'],
  accessToken: string,
  connection: typeof backupOAuthConnectionSchema.Type,
  slot: BackupSlot<R>
) {
  let retained = slot.pendingObjectId;
  let rejected: string | undefined;

  for (let attempt = 0; attempt < 2; attempt++) {
    const id = yield* backupAttempt((signal) =>
      provider.ensureUpload(accessToken, slot.name, retained, signal, rejected)
    );

    if (id !== retained) yield* slot.checkpoint(connection, id);

    const result = yield* backupAttempt((signal) =>
      provider.upload(accessToken, slot.name, slot.bytes, signal, id)
    );

    if (result !== 'rejected-id') return;

    yield* slot.checkpoint(connection);
    retained = undefined;
    rejected = id;
  }

  return yield* Effect.fail(
    new StudyError('transient', 'Google Drive rejected its backup file ID')
  );
}

export function oauthStrategy<K extends keyof OAuth, R>(
  providers: OAuth,
  kind: K
): BackupStrategy<K, R> {
  const provider: OAuth[keyof OAuth] = providers[kind];

  return {
    location: () => null,
    publish: Effect.fnUntraced(function* (connection, slot) {
      const secret = 'clientSecret' in connection ? connection.clientSecret : undefined;
      const token = yield* backupAttempt((signal) =>
        provider.refresh(connection.clientId, connection.refreshToken, signal, secret)
      );
      const updated = token.refresh_token
        ? { ...connection, refreshToken: token.refresh_token }
        : connection;

      if (updated.refreshToken !== connection.refreshToken)
        yield* slot.checkpoint(updated, slot.pendingObjectId);

      if ('ensureUpload' in provider)
        return yield* publishDriveBackup(provider, token.access_token, updated, slot);

      yield* backupAttempt((signal) =>
        provider.upload(token.access_token, slot.name, slot.bytes, signal)
      );
    })
  };
}
