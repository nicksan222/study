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

import type { StudyError } from '@study/contracts';
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
  readonly createModel: (options: ApiKeyModelOptions) => AiModel;
}

export function defineApiKeyProvider(
  definition: Omit<ApiKeyProvider, 'catalogId'> & { readonly catalogId?: string }
): ApiKeyProvider {
  return { ...definition, catalogId: definition.catalogId ?? definition.id };
}
