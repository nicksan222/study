import { StudyError } from '@study/contracts/errors';
import { and, eq, sql } from '@study/db';
import { workflow_configuration_waits, workflow_executions } from '@study/db/schema';
import { Context, Effect, Exit } from 'effect';
import { DurableDeferred } from 'effect/workflow';
import type { WorkflowEngine } from 'effect/workflow';

import type { ServerContext } from '#server/platform/database/context';

/** Runtime-supplied opaque, nonsecret fingerprint of model configuration. */
export class WorkflowConfiguration extends Context.Service<
  WorkflowConfiguration,
  { readonly revision: Effect.Effect<string, StudyError> }
>()('study/WorkflowConfiguration') {}

/** Complete native deferreds, including registrations made after the configuration changed. */
export function notifyConfigurationChanged(
  context: ServerContext,
  engine: WorkflowEngine.WorkflowEngine['Service'],
  revision: string
) {
  return Effect.gen(function* () {
    const rows = yield* Effect.try({
      try: () =>
        context.db.orm
          .select({
            executionId: workflow_configuration_waits.execution_id,
            deferredName: workflow_configuration_waits.deferred_name,
            workflowName: workflow_executions.workflow_tag,
            status: workflow_executions.status
          })
          .from(workflow_configuration_waits)
          .innerJoin(
            workflow_executions,
            eq(workflow_executions.execution_id, workflow_configuration_waits.execution_id)
          )
          .where(
            sql`${workflow_configuration_waits.observed_revision} <> ${revision} OR ${workflow_executions.status} IN ('completed', 'cancelled')`
          )
          .limit(1000)
          .all(),
      catch: (cause) =>
        new StudyError('internal', 'Workflow configuration notification failed', { cause })
    });

    for (const row of rows) {
      if (row.status !== 'completed' && row.status !== 'cancelled')
        yield* engine.deferredDone(DurableDeferred.make(row.deferredName), {
          workflowName: row.workflowName,
          executionId: row.executionId,
          deferredName: row.deferredName,
          exit: Exit.void
        });

      yield* Effect.try({
        try: () =>
          context.transaction(() =>
            context.db.orm
              .delete(workflow_configuration_waits)
              .where(
                and(
                  eq(workflow_configuration_waits.execution_id, row.executionId),
                  eq(workflow_configuration_waits.deferred_name, row.deferredName)
                )
              )
              .run()
          ),
        catch: (cause) =>
          new StudyError('internal', 'Workflow configuration cleanup failed', { cause })
      });
    }

    return rows.length;
  });
}
