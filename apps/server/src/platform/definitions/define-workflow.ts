/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Declares a versioned native Effect Workflow with typed payload, result, error, and │
 * │ idempotency key. Version validation is performed before attaching the version to the     │
 * │ workflow identity.                                                                       │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Exports defineWorkflow. Version validation is performed before attaching the version   │
 * │   to the workflow identity.                                                              │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Feature modules use this typed declaration helper; it checks contracts but leaves domain │
 * │ data and business policy in the feature.                                                 │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import type { Schema } from 'effect';
import * as Workflow from 'effect/workflow/Workflow';

/** Declare a versioned native workflow without changing its execution semantics. */
export function defineWorkflow<
  const Name extends string,
  const Version extends number,
  P extends Workflow.AnyStructSchema,
  S extends Schema.Top,
  E extends Schema.Top
>(definition: {
  name: Name;
  version: Version;
  payload: P;
  success: S;
  error: E;
  idempotencyKey: (payload: P['Type']) => string;
}) {
  if (!Number.isSafeInteger(definition.version) || definition.version < 1)
    throw new TypeError('Workflow version must be a positive integer');

  const workflow = Workflow.make(`${definition.name}/v${definition.version}`, definition);

  return Object.defineProperty(workflow, 'version', {
    value: definition.version
  }) as typeof workflow & {
    readonly version: Version;
  };
}
