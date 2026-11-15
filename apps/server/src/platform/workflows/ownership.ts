/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Reads native workflow identity for domain publication authorization.               │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Exports the current native workflow identity accessor.                                 │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Effect owns execution; this module creates no leases or checkpoints.                     │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { StudyError } from '@study/contracts';
import { Effect, Option } from 'effect';
import { Activity, WorkflowEngine } from 'effect/workflow';

/** Read native identity without manufacturing an execution lease. */
export const currentWorkflowActivityOwner = Effect.gen(function* () {
  const instance = yield* Effect.serviceOption(WorkflowEngine.WorkflowInstance);

  if (Option.isNone(instance))
    return yield* Effect.fail(
      new StudyError('internal', 'Workflow activity identity is unavailable')
    );

  return { executionId: instance.value.executionId, attempt: yield* Activity.CurrentAttempt };
});
