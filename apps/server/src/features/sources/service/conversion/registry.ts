/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Defines typed conversion strategies and validates their canonical document         │
 * │ outputs.                                                                                 │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Discovers registered conversion methods and dispatches typed inputs.                   │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Callers own workflow activities, model execution and all persistent publication.         │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { StudyError } from '@study/contracts/errors';
import {
  conversionStrategyIdSchema,
  textConversionInputSchema
} from '@study/contracts/sources/conversion';
import type { Document } from '@study/contracts/sources/document';
import { documentSchema } from '@study/contracts/sources/schemas';
import { text } from '@study/localization';
import type { Locale, StaticMessageKey } from '@study/localization';
import { Effect, Schema } from 'effect';

import { checkInput, DEFAULT_MAX_BYTES } from '#server/features/sources/decoders/common';
import type { Agents } from '#server/platform/ai/agents';
import type { AgentDefinition } from '#server/platform/definitions/define-agent';

export type ConversionInput = { kind: 'text'; text: string } | { kind: 'pdf'; bytes: Uint8Array };

export interface ConversionContext {
  readonly generate: <
    I extends Schema.ConstraintDecoder<unknown>,
    O extends Schema.ConstraintDecoder<unknown>
  >(
    definition: AgentDefinition<I, O>,
    input: I['Type']
  ) => Effect.Effect<O['Type'], StudyError, Agents>;
}

export interface ConversionStrategy<R = Agents> {
  readonly id: string;
  readonly label: StaticMessageKey;
  readonly supportedInputs: readonly ConversionInput['kind'][];
  readonly convert: (
    input: ConversionInput,
    context: ConversionContext
  ) => Effect.Effect<Document, StudyError, R>;
}

export function makeConversionRegistry<R>(strategies: readonly ConversionStrategy<R>[]) {
  const entries = new Map(strategies.map((strategy) => [strategy.id, strategy]));

  if (
    entries.size !== strategies.length ||
    strategies.some((strategy) => !Schema.is(conversionStrategyIdSchema)(strategy.id))
  )
    throw new RangeError('Invalid or duplicate conversion strategy');

  function requireStrategy(id: string) {
    const strategy = entries.get(id);

    if (!strategy) throw new StudyError('unsupported', 'Conversion strategy is unavailable');

    return strategy;
  }

  return {
    requireStrategy,
    forInput: (preferredId: string, kind: ConversionInput['kind']) => {
      const preferred = requireStrategy(preferredId);

      if (preferred.supportedInputs.includes(kind)) return preferred;

      const fallback = strategies.find((strategy) => strategy.supportedInputs.includes(kind));

      if (!fallback)
        throw new StudyError('unsupported', 'No conversion strategy supports this input');

      return fallback;
    },
    list: (locale: Locale) =>
      strategies.map((strategy) => ({
        id: strategy.id,
        name: text(locale, strategy.label),
        supportedInputs: [...strategy.supportedInputs]
      })),
    convert: (id: string, input: ConversionInput, context: ConversionContext) =>
      Effect.gen(function* () {
        const strategy = yield* Effect.try({
          try: () => requireStrategy(id),
          catch: (error) =>
            error instanceof StudyError
              ? error
              : new StudyError('internal', 'Invalid conversion strategy', { cause: error })
        });

        if (!strategy.supportedInputs.includes(input.kind))
          return yield* Effect.fail(
            new StudyError('unsupported', 'Conversion input is unsupported')
          );

        yield* Effect.try({
          try: () => {
            if (input.kind === 'pdf') checkInput(input.bytes, DEFAULT_MAX_BYTES);
            else Schema.decodeUnknownSync(textConversionInputSchema)(input);
          },
          catch: (cause) =>
            cause instanceof StudyError
              ? cause
              : new StudyError('invalid_input', 'Invalid conversion input', { cause })
        });

        const result = yield* strategy.convert(input, context);

        return yield* Effect.try({
          try: () => {
            const document = Schema.decodeUnknownSync(documentSchema)(result);

            if (
              !document.blocks.some((block) => block.text.trim()) ||
              (input.kind === 'text' &&
                document.blocks.reduce((size, block) => size + block.text.length, 0) > 100_000)
            )
              throw new StudyError('invalid_input', 'Conversion returned empty or oversized text');

            return document;
          },
          catch: (cause) =>
            cause instanceof StudyError
              ? cause
              : new StudyError('invalid_input', 'Invalid conversion output', { cause })
        });
      })
  };
}
