import type { Schema } from 'effect';
import * as Workflow from 'effect/workflow/Workflow';

/** Declare a versioned native workflow without changing its execution semantics. */
export function defineWorkflow<
  const Name extends string,
  P extends Workflow.AnyStructSchema,
  S extends Schema.Top,
  E extends Schema.Top
>(definition: {
  name: Name;
  version: number;
  payload: P;
  success: S;
  error: E;
  idempotencyKey: (payload: P['Type']) => string;
}) {
  if (!Number.isSafeInteger(definition.version) || definition.version < 1)
    throw new TypeError('Workflow version must be a positive integer');

  return Workflow.make(`${definition.name}/v${definition.version}`, definition);
}
