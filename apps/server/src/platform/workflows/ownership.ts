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
