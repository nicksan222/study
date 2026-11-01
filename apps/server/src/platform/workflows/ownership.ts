/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Defines the execution lease capability granted to one workflow activity attempt.   │
 * │ The accessor fails with a typed internal error when code runs outside an owned activity. │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Exports WorkflowActivityOwner, currentWorkflowActivityOwner. The accessor fails with a │
 * │   typed internal error when code runs outside an owned activity.                         │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ The SQLite workflow engine supplies this capability during each activity attempt;        │
 * │ callers cannot construct valid ownership from payload data.                              │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { StudyError } from '@study/contracts/errors';
import { Context, Effect, Option } from 'effect';

/** The SQLite engine grants this identity from its captured lease for one activity attempt. */
export class WorkflowActivityOwner extends Context.Service<
  WorkflowActivityOwner,
  {
    readonly executionId: string;
    readonly ownerToken: string;
    readonly activityName: string;
    readonly attempt: number;
  }
>()('study/WorkflowActivityOwner') {}

/** Native encoded activity execution supplies the capability dynamically. */
export const currentWorkflowActivityOwner = Effect.serviceOption(WorkflowActivityOwner).pipe(
  Effect.flatMap((owner) =>
    Option.isSome(owner)
      ? Effect.succeed(owner.value)
      : Effect.fail(new StudyError('internal', 'Workflow activity ownership is unavailable'))
  )
);
