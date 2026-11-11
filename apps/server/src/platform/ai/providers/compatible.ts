/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Constructs shared AI SDK adapters for providers implementing the Chat Completions  │
 * │ protocol.                                                                                │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Applies provider endpoints, explicit credentials and structured output support.        │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Individual provider modules own defaults; this transport shares no feature behavior.     │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { LanguageModelV3, LanguageModelV3CallOptions } from '@ai-sdk/provider';

import { defineApiKeyProvider, sdkFetch } from './definition.ts';
import type { ProviderDefinition } from './definition.ts';

/** JSON-object mode also works for providers that cannot stream strict JSON Schema. */
function jsonMode(options: LanguageModelV3CallOptions): LanguageModelV3CallOptions {
  if (options.responseFormat?.type !== 'json' || !options.responseFormat.schema) return options;

  return {
    ...options,
    responseFormat: { type: 'json' },
    prompt: [
      {
        role: 'system',
        content: `Respond with a JSON object matching this JSON Schema. Do not wrap it in Markdown.\n${JSON.stringify(options.responseFormat.schema)}`
      },
      ...options.prompt
    ]
  };
}

function withJsonMode(model: LanguageModelV3): LanguageModelV3 {
  const generate = model.doGenerate.bind(model);
  const stream = model.doStream.bind(model);

  return Object.assign(model, {
    doGenerate: (options: LanguageModelV3CallOptions) => generate(jsonMode(options)),
    doStream: (options: LanguageModelV3CallOptions) => stream(jsonMode(options))
  });
}

export function compatibleProvider<
  const Id extends string,
  const Models extends readonly [string, ...string[]]
>(definition: Omit<ProviderDefinition<Id, Models>, 'createModel'> & { baseURL: string }) {
  const { baseURL, ...metadata } = definition;

  return defineApiKeyProvider({
    ...metadata,
    createModel: ({ apiKey, modelId, fetch }) =>
      withJsonMode(
        createOpenAICompatible({
          name: metadata.id,
          baseURL,
          apiKey,
          fetch: fetch ? sdkFetch(fetch) : undefined
        }).chatModel(modelId)
      )
  });
}
