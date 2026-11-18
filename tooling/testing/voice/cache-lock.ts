import { Database, SQLiteError } from 'bun:sqlite';

import { Effect, Schedule } from 'effect';

/** SQLite's writer lock works across processes and releases on exit, even after a crash. */
export function withFixtureCacheLock<A, E, R>(lockPath: string, prepare: Effect.Effect<A, E, R>) {
  return Effect.acquireUseRelease(
    Effect.try(() => new Database(lockPath)),
    (lock) =>
      Effect.try({ try: () => lock.run('BEGIN IMMEDIATE'), catch: (cause) => cause }).pipe(
        Effect.retry({
          schedule: Schedule.spaced('250 millis'),
          while: (error) => error instanceof SQLiteError && error.code === 'SQLITE_BUSY'
        }),
        Effect.andThen(Effect.uninterruptible(prepare))
      ),
    (lock) => Effect.sync(() => lock.close())
  );
}
