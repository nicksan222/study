/** @file Defines typed preparation, display, and publication for a backup destination. */

import type {
  StudyError,
  automaticBackupFileDestinationSchema,
  backupOAuthConnectionSchema,
  storageBackupDestinationSchema
} from '@study/contracts';
import { normalizeError } from '@study/server';
import { Effect } from 'effect';

export type Destination =
  | typeof automaticBackupFileDestinationSchema.Type
  | typeof backupOAuthConnectionSchema.Type
  | typeof storageBackupDestinationSchema.Type;

export type DestinationKind = Destination['kind'];

export type DestinationFor<K extends DestinationKind> = {
  [P in DestinationKind]: Extract<Destination, { kind: P }>;
}[K] & { readonly kind: K };

export type BackupSlot<R = never> = {
  name: string;
  bytes: Uint8Array<ArrayBuffer>;
  pendingObjectId?: string;
  checkpoint: (
    connection: typeof backupOAuthConnectionSchema.Type,
    objectId?: string
  ) => Effect.Effect<void, StudyError, R>;
};

export type BackupStrategy<K extends DestinationKind, R = never> = {
  prepare?: (destination: DestinationFor<K>) => Effect.Effect<DestinationFor<K>, StudyError>;
  location: (destination: DestinationFor<K>) => string | null;
  publish: (
    destination: DestinationFor<K>,
    slot: BackupSlot<R>
  ) => Effect.Effect<void, StudyError, R>;
};

export const backupAttempt = <A>(run: (signal: AbortSignal) => Promise<A>) =>
  Effect.tryPromise({ try: run, catch: normalizeError });
