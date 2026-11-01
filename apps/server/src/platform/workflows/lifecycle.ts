/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Defines the application-owned capability for starting and stopping the scoped      │
 * │ workflow consumer. Runtime services expose its state and typed lifecycle operations.     │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Exports WorkerLifecycle. Runtime services expose its state and typed lifecycle         │
 * │   operations.                                                                            │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ App provides these start/stop operations to system services; Workers owns the consumer   │
 * │ state and its scoped runtime.                                                            │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

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
