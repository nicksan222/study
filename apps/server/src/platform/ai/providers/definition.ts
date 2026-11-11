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

/** Preserve runtime fetch properties while adapting an injected callable for SDK types. */
export function sdkFetch(
  request: (...args: Parameters<typeof globalThis.fetch>) => ReturnType<typeof globalThis.fetch>
): typeof globalThis.fetch {
  return new Proxy(globalThis.fetch, {
    apply: (_target, _receiver, args) => request(...(args as Parameters<typeof globalThis.fetch>))
  });
}

export interface ApiKeyProvider {
  readonly id: string;
  readonly name: string;
  readonly models: readonly string[];
  readonly defaults: Readonly<Record<ModelTier, string>>;
  readonly createModel: (options: {
    apiKey: string;
    modelId: string;
    fetch?: (...args: Parameters<typeof fetch>) => ReturnType<typeof fetch>;
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
