/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Constructs canonical native workflow activities from effects or lazy generators.   │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Keeps failure codecs and generator adaptation in one typed harness.                    │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Native Effect Activity owns execution, checkpoint identity and replay.                   │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { failureSchema } from '@study/contracts/errors';
import type { Failure } from '@study/contracts/errors';
import { Effect } from 'effect';
import type { Schema } from 'effect';
import { Activity } from 'effect/workflow';

type Definition<S extends Schema.Constraint> = { readonly name: string; readonly success?: S };

export function defineActivity<
  S extends Schema.Constraint = Schema.Void,
  Y extends Effect.Effect<any, Failure, any> = never
>(
  definition: Definition<S> & { readonly execute: () => Generator<Y, NoInfer<S['Type']>, never> }
): ReturnType<typeof activityEffect<S, Effect.Services<Y>>>;

export function defineActivity<S extends Schema.Constraint = Schema.Void, R = never>(
  definition: Definition<S> & { readonly execute: Effect.Effect<NoInfer<S['Type']>, Failure, R> }
): ReturnType<typeof activityEffect<S, R>>;

export function defineActivity(
  definition: Definition<Schema.Constraint> & {
    readonly execute:
      | Effect.Effect<any, Failure, any>
      | (() => Generator<Effect.Effect<any, Failure, any>, any, never>);
  }
) {
  return activityEffect({
    ...definition,
    execute:
      typeof definition.execute === 'function' ? Effect.gen(definition.execute) : definition.execute
  });
}

function activityEffect<S extends Schema.Constraint, R>(
  definition: Definition<S> & { readonly execute: Effect.Effect<S['Type'], Failure, R> }
) {
  return Activity.make({ ...definition, error: failureSchema });
}
