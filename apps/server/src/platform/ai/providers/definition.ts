/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Defines the shared contract for provider identity, suggested models and Effect model  │
 * │ construction.                                                                            │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Keeps provider metadata and model factory inputs statically checked.                   │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Provider modules implement this interface; Auth owns private API key persistence.        │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import type { ModelTier, StudyError } from '@study/contracts';
import type { Effect, Schema } from 'effect';

import type { AiModel } from '#server/platform/ai/model';

export interface ApiKeyModelOptions {
  apiKey: string;
  resolveApiKey?: Effect.Effect<string, StudyError>;
  modelId: string;
  outputSchema?: Schema.Top & Schema.ConstraintDecoder<unknown>;
  fetch?: (...args: Parameters<typeof fetch>) => ReturnType<typeof fetch>;
}

export interface ApiKeyProvider {
  readonly id: string;
  readonly name: string;
  readonly catalogId: string;
  readonly models: readonly string[];
  readonly defaults: Readonly<Record<ModelTier, string>>;
  readonly createModel: (options: ApiKeyModelOptions) => AiModel;
}

/** Model tuples infer the permitted IDs; defaults cannot introduce undeclared models. */
export type ProviderDefinition<
  Id extends string,
  Models extends readonly [string, ...string[]]
> = Omit<ApiKeyProvider, 'id' | 'catalogId' | 'models' | 'defaults'> & {
  readonly id: Id;
  readonly catalogId?: string;
  readonly models: Models;
  readonly defaults: Readonly<Record<ModelTier, NoInfer<Models[number]>>>;
};

export function defineApiKeyProvider<
  const Id extends string,
  const Models extends readonly [string, ...string[]]
>(definition: ProviderDefinition<Id, Models>) {
  return { ...definition, catalogId: definition.catalogId ?? definition.id };
}
