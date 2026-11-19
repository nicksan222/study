/** @file Refreshes OAuth access and checkpoints provider state before publishing a slot. */

import type { backupOAuth } from '@study/server';
import { Effect } from 'effect';

import { backupAttempt } from './strategy.ts';
import type { BackupStrategy } from './strategy.ts';

type OAuth = ReturnType<typeof backupOAuth>;

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

      const id =
        'ensureUpload' in provider
          ? yield* backupAttempt((signal) =>
              provider.ensureUpload(token.access_token, slot.name, slot.pendingObjectId, signal)
            )
          : undefined;

      if (id && id !== slot.pendingObjectId) yield* slot.checkpoint(updated, id);

      yield* backupAttempt((signal) =>
        provider.upload(token.access_token, slot.name, slot.bytes, signal, id)
      );
    })
  };
}
