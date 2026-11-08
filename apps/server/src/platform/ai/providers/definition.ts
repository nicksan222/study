/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Defines the shared contract for provider identity, suggested models and SDK model  │
 * │ construction.                                                                            │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Keeps provider metadata and model factory inputs statically checked.                   │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Provider modules implement this interface; Auth owns private API key persistence.        │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import type { LanguageModelV3 } from '@ai-sdk/provider';
import type { ModelTier } from '@study/contracts/settings/schemas';

export interface ApiKeyProvider {
  readonly id: string;
  readonly name: string;
  readonly models: readonly string[];
  readonly defaults: Readonly<Record<ModelTier, string>>;
  readonly createModel: (options: {
    apiKey: string;
    modelId: string;
    fetch?: typeof fetch;
  }) => LanguageModelV3;
}

/** Model tuples infer the permitted IDs; defaults cannot introduce undeclared models. */
export type ProviderDefinition<
  Id extends string,
  Models extends readonly [string, ...string[]]
> = Omit<ApiKeyProvider, 'id' | 'models' | 'defaults'> & {
  readonly id: Id;
  readonly models: Models;
  readonly defaults: Readonly<Record<ModelTier, NoInfer<Models[number]>>>;
};

export function defineApiKeyProvider<
  const Id extends string,
  const Models extends readonly [string, ...string[]]
>(definition: ProviderDefinition<Id, Models>): ProviderDefinition<Id, Models> {
  return definition;
}
