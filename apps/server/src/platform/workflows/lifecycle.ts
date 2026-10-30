import type { StudyError } from '@study/contracts/errors';
import { Context } from 'effect';
import type { Effect } from 'effect';

/** Application-owned control of the scoped workflow consumer. */
export class WorkerLifecycle extends Context.Service<
  WorkerLifecycle,
  {
    readonly started: Effect.Effect<boolean>;
    readonly start: Effect.Effect<void, StudyError>;
    readonly stop: Effect.Effect<void, StudyError>;
  }
>()('study/WorkerLifecycle') {}
