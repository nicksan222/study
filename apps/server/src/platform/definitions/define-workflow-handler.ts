/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Combines a versioned native workflow with its execution implementation and event   │
 * │ subscriptions. The type boundary ensures subscribed events can populate the workflow     │
 * │ payload.                                                                                 │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Exports defineWorkflowHandler. The type boundary ensures subscribed events can         │
 * │   populate the workflow payload.                                                         │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Feature modules use this typed declaration helper; it checks contracts but leaves domain │
 * │ data and business policy in the feature.                                                 │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import type { WorkflowEvent } from '@study/contracts';
import { workflow_executions } from '@study/db';
import { Effect, Schema } from 'effect';
import type * as Workflow from 'effect/workflow/Workflow';

import { AiWorkload } from '#server/platform/ai/admission';
import { Database } from '#server/platform/database/database';
import type { EventType, Trigger } from '#server/platform/workflows/triggers';

type PayloadEvent<P extends Workflow.AnyStructSchema> = {
  [Event in EventType]: {
    event: Extract<WorkflowEvent, { type: Event }>;
  } extends P['Type']
    ? Event
    : never;
}[EventType];

type WorkflowSubscription<P extends Workflow.AnyStructSchema> = {
  readonly subscription: string;
  readonly event: PayloadEvent<P>;
  readonly emits: readonly EventType[];
  readonly enabled?: () => boolean;
};

function admitExecution(identity: {
  executionId: string;
  tag: string;
  version: number;
  payload: string;
}) {
  return Database.use(({ store }) =>
    Effect.sync(() => {
      store.transaction(['workflows'], (tx) => {
        tx.db.orm
          .insert(workflow_executions)
          .values({
            execution_id: identity.executionId,
            workflow_tag: identity.tag,
            version: identity.version,
            payload: identity.payload,
            status: 'running',
            created_at: BigInt(store.clock.currentTimeMillisUnsafe()),
            updated_at: BigInt(store.clock.currentTimeMillisUnsafe())
          })
          .onConflictDoNothing()
          .run();
      });
    })
  );
}

/** Register native execution and subscriptions from one versioned workflow definition. */
export function defineWorkflowHandler<
  const Name extends string,
  P extends Workflow.AnyStructSchema,
  S extends Schema.Top,
  E extends Schema.Top,
  R
>(
  workflow: Workflow.Workflow<Name, P, S, E> & { readonly version: number },
  options: {
    readonly workload?: 'interactive' | 'bulk';
    readonly execute: (
      payload: NoInfer<P['Type']>,
      executionId: string
    ) => Effect.Effect<NoInfer<S['Type']>, NoInfer<E['Type']>, R>;
    readonly triggers: readonly WorkflowSubscription<NoInfer<P>>[];
  }
) {
  const triggers: readonly Trigger[] = options.triggers.map((trigger) => ({
    ...trigger,
    workflow,
    workflowVersion: workflow.version,
    enabled: trigger.enabled ?? (() => true)
  }));

  return {
    definition: workflow,
    layer: workflow.toLayer((payload, executionId) => {
      const initialize = Schema.encodeEffect(Schema.toCodecJson(workflow.payloadSchema))(
        payload
      ).pipe(
        Effect.orDie,
        Effect.flatMap((encoded) =>
          admitExecution({
            executionId,
            tag: workflow._tag,
            version: workflow.version,
            payload: JSON.stringify(encoded)
          })
        )
      );

      return initialize.pipe(
        Effect.andThen(
          options
            .execute(payload, executionId)
            .pipe(Effect.provideService(AiWorkload, options.workload ?? 'interactive'))
        )
      );
    }),
    triggers
  };
}
