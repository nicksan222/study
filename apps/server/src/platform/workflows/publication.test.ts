import { StudyError } from '@study/contracts';
/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Verifies transactional publication authorization and scoped guard lifetime.        │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Tests cancellation, retirement, generation changes and escaped guards.                 │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Uses real SQLite domain records and native workflow identities.                          │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */
import { eq } from '@study/db';
import { workflow_executions, workflow_retired_executions } from '@study/db';
import { test } from '@study/testing';
import { Effect, Schema } from 'effect';
import { Workflow, WorkflowEngine } from 'effect/workflow';

import { ServerContext } from '#server/platform/database/context';
import { PublicationGuard, withPublicationGuard } from '#server/platform/workflows/publication';

const definition = Workflow.make('publication-test', {
  payload: { id: Schema.String },
  idempotencyKey: ({ id }) => id
});

test.stable(
  'publication fences cancellation, supersession, retirement and escaped guards',
  async ({ databases, expect }) => {
    const location = await databases();
    const context = new ServerContext(await location.open());

    context.db.orm
      .insert(workflow_executions)
      .values({
        execution_id: 'publication',
        workflow_tag: definition._tag,
        version: 1,
        payload: '{}',
        status: 'running',
        created_at: 0n,
        updated_at: 0n
      })
      .run();
    const instance = WorkflowEngine.WorkflowInstance.initial(definition, 'publication');
    const assertGuard = (guard: PublicationGuard['Service']) =>
      context.transaction(['workflows'], (transaction) => guard.assert(transaction));
    let escaped: PublicationGuard['Service'] | undefined;

    try {
      await Effect.runPromise(
        withPublicationGuard(
          context,
          Effect.gen(function* () {
            const guard = yield* PublicationGuard;

            escaped = guard;
            const closed = yield* withPublicationGuard(context, PublicationGuard);

            expect(() => assertGuard(closed)).toThrow(StudyError);
            assertGuard(guard);
            context.db.orm
              .update(workflow_executions)
              .set({ generation: 2 })
              .where(eq(workflow_executions.execution_id, 'publication'))
              .run();
            expect(() => assertGuard(guard)).toThrow(StudyError);
            context.db.orm
              .update(workflow_executions)
              .set({ generation: 1, cancellation_mode: 'safe', status: 'cancelling' })
              .where(eq(workflow_executions.execution_id, 'publication'))
              .run();
            expect(() => assertGuard(guard)).toThrow(StudyError);
            context.db.orm
              .update(workflow_executions)
              .set({ cancellation_mode: null, status: 'running' })
              .where(eq(workflow_executions.execution_id, 'publication'))
              .run();
            context.db.orm
              .insert(workflow_retired_executions)
              .values({ execution_id: 'publication', correlation_id: 'deleted' })
              .run();
            expect(() => assertGuard(guard)).toThrow(StudyError);
          })
        ).pipe(Effect.provideService(WorkflowEngine.WorkflowInstance, instance))
      );
      expect(() =>
        context.transaction(['workflows'], (transaction) => escaped!.assert(transaction))
      ).toThrow(StudyError);
      const failure = await Effect.runPromise(
        Effect.flip(withPublicationGuard(context, Effect.void))
      );

      expect(failure.kind).toBe('internal');
    } finally {
      context.close();
      await location.cleanup();
    }
  }
);
