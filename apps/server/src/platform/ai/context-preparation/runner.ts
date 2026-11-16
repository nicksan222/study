/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Executes bounded context preparation through official native workflow Activities.  │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Checkpoints plans, mapped outputs and deterministic bounded reduction trees.           │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Feature callbacks own semantics, current authority checks and final domain publication.  │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { StudyError } from '@study/contracts';
import type { Failure } from '@study/contracts';
import { Effect, Schema } from 'effect';

import { resumableActivity } from '#server/platform/definitions/define-activity';

import { sourcePassagePlanSchema, serializedBytes } from './planner.ts';
import type { SourcePassageGroup, SourcePassagePlan } from './planner.ts';

const positive = Schema.Int.check(
  Schema.isBetween({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER })
);

const contextReductionLimitsSchema = Schema.Struct({
  maxResultBytes: positive,
  maxReductionBytes: positive,
  maxFanout: positive,
  maxLevels: positive
}).check(
  Schema.makeFilter(
    (limits) => limits.maxFanout >= 2 && limits.maxFanout <= 128 && limits.maxLevels <= 32
  )
);

export type ContextReductionLimits = typeof contextReductionLimitsSchema.Type;

export interface ReductionContext {
  readonly level: number;
  readonly index: number;
}

export function acceptSourcePlan<Ref, R>(options: {
  readonly name: string;
  readonly referenceSchema: Schema.Codec<Ref, unknown>;
  readonly plan: Effect.Effect<SourcePassagePlan<Ref>, Failure, R>;
  readonly preflight: Effect.Effect<unknown, Failure, R>;
  readonly limits: ContextReductionLimits;
}) {
  return Effect.gen(function* () {
    if (!options.name.trim())
      return yield* Effect.fail(
        new StudyError('invalid_input', 'Context preparation requires a namespace')
      );

    const prefix = `${options.name}/document-processing-v1`;
    const acceptedSchema = Schema.Struct({
      plan: sourcePassagePlanSchema(options.referenceSchema),
      limits: contextReductionLimitsSchema
    });

    yield* options.preflight;
    const accepted = yield* resumableActivity({
      name: `${prefix}/plan`,
      success: acceptedSchema,
      execute: Effect.gen(function* () {
        yield* options.preflight;
        const limits = yield* Effect.try({
          try: () => Schema.decodeUnknownSync(contextReductionLimitsSchema)(options.limits),
          catch: (cause) =>
            new StudyError('invalid_input', 'Invalid context execution limits', { cause })
        });
        const plan = yield* options.plan;

        return yield* Effect.try({
          try: () => Schema.decodeUnknownSync(Schema.toType(acceptedSchema))({ plan, limits }),
          catch: (cause) =>
            new StudyError('invalid_input', 'Invalid context execution plan', { cause })
        });
      })
    });

    return accepted;
  });
}

export function processSourcePassages<Ref, Value, R>(options: {
  readonly name: string;
  readonly referenceSchema: Schema.Codec<Ref, unknown>;
  readonly mappedSchema: Schema.Codec<Value, unknown>;
  readonly plan: Effect.Effect<SourcePassagePlan<Ref>, Failure, R>;
  readonly preflight: Effect.Effect<unknown, Failure, R>;
  readonly map: (
    piece: SourcePassageGroup<Ref>,
    plan: SourcePassagePlan<Ref>
  ) => Effect.Effect<Value, Failure, R>;
  readonly reduce: (
    values: readonly Value[],
    context: ReductionContext,
    plan: SourcePassagePlan<Ref>
  ) => Effect.Effect<Value, Failure, R>;
  readonly limits: ContextReductionLimits;
}) {
  return Effect.gen(function* () {
    const prefix = `${options.name}/document-processing-v1`;
    const accepted = yield* acceptSourcePlan(options);
    const { plan, limits } = accepted;
    const jsonSchema = Schema.toCodecJson(options.mappedSchema);
    const bounded = (effect: Effect.Effect<Value, Failure, R>) =>
      effect.pipe(
        Effect.flatMap((value) =>
          Effect.try({
            try: () => {
              const encoded = Schema.encodeSync(jsonSchema)(value);

              if (serializedBytes(encoded) > limits.maxResultBytes)
                throw new StudyError(
                  'not_enough',
                  'Context preparation result exceeds the declared budget'
                );

              return Schema.decodeUnknownSync(options.mappedSchema)(
                Schema.encodeSync(options.mappedSchema)(value)
              );
            },
            catch: (cause) =>
              cause instanceof StudyError
                ? cause
                : new StudyError('invalid_input', 'Invalid context preparation result', { cause })
          })
        )
      );
    let values: Value[] = [];

    for (const piece of plan.pieces) {
      yield* options.preflight;
      const value = yield* resumableActivity({
        name: `${prefix}/map/${piece.index}`,
        success: options.mappedSchema,
        execute: bounded(
          options.preflight.pipe(Effect.andThen(Effect.suspend(() => options.map(piece, plan))))
        )
      });

      values.push(value);
    }

    for (let level = 0; values.length > 1; level++) {
      if (level >= limits.maxLevels)
        return yield* Effect.fail(
          new StudyError('not_enough', 'Document reduction exceeds the declared depth')
        );

      const next: Value[] = [];

      for (let offset = 0; offset < values.length;) {
        const context = { level, index: next.length };
        const group = yield* Effect.try({
          try: () =>
            reductionGroup(values, offset, context, limits, (item) =>
              Schema.encodeSync(jsonSchema)(item)
            ),
          catch: (cause) =>
            cause instanceof StudyError
              ? cause
              : new StudyError('invalid_input', 'Invalid reduction input', { cause })
        });

        offset += group.length;
        yield* options.preflight;
        next.push(
          yield* resumableActivity({
            name: `${prefix}/reduce/${level}/${context.index}`,
            success: options.mappedSchema,
            execute: bounded(
              options.preflight.pipe(
                Effect.andThen(Effect.suspend(() => options.reduce(group, context, plan)))
              )
            )
          })
        );
      }

      if (next.length >= values.length)
        return yield* Effect.fail(
          new StudyError('not_enough', 'Document reduction budget cannot combine results')
        );

      values = next;
    }

    yield* options.preflight;

    return { value: values[0]!, plan };
  });
}

function reductionGroup<Value>(
  values: readonly Value[],
  offset: number,
  context: ReductionContext,
  limits: ContextReductionLimits,
  encode: (value: Value) => unknown
) {
  const group: Value[] = [];

  while (offset < values.length && group.length < limits.maxFanout) {
    const value = values[offset]!;

    if (
      serializedBytes({ ...context, values: [...group, value].map(encode) }) >
      limits.maxReductionBytes
    )
      break;

    group.push(value);
    offset++;
  }

  if (!group.length)
    throw new StudyError('not_enough', 'A document result cannot fit the reduction budget');

  return group;
}
