import type { WorkflowEvent } from '@study/contracts/events';
import type { Effect, Schema } from 'effect';
import type * as Workflow from 'effect/workflow/Workflow';

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
    layer: workflow.toLayer(options.execute),
    triggers
  };
}
