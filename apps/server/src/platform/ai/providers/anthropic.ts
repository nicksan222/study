/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Defines Anthropic defaults and API key model construction for the shared provider  │
 * │ registry.                                                                                │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Owns Anthropic identity, suggested models and provider configuration.                       │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Provider credentials are supplied by Auth; feature agents consume the shared model       │
 * │ interface.                                                                               │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { AnthropicClient, AnthropicLanguageModel, AnthropicTool } from '@effect/ai-anthropic';
import { Effect, Layer, Schema } from 'effect';
import { AnthropicStructuredOutput, Model } from 'effect/ai';

import type { AiModel } from '#server/platform/ai/model';

import type { ApiKeyModelOptions } from './definition.ts';
import { defineApiKeyProvider } from './definition.ts';
import { withProviderTools } from './tools.ts';
import { providerHttpLayer } from './transport.ts';

export const anthropic = defineApiKeyProvider({
  id: 'anthropic',
  name: 'Anthropic',
  createModel: createAnthropicModel
});

function createAnthropicModel(options: ApiKeyModelOptions): AiModel {
  const clientLayer = Layer.effect(
    AnthropicClient.AnthropicClient,
    Effect.gen(function* () {
      const client = yield* AnthropicClient.make({});
      const format = options.outputSchema
        ? {
            type: 'json_schema' as const,
            schema: Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Json))(
              AnthropicStructuredOutput.toCodecAnthropic(options.outputSchema).jsonSchema
            )
          }
        : undefined;

      return {
        ...client,
        createMessage: (input) =>
          client.createMessage({
            ...input,
            payload: {
              ...input.payload,
              output_config: format
                ? { ...input.payload.output_config, format }
                : input.payload.output_config
            }
          }),
        createMessageStream: (input) =>
          client.createMessageStream({
            ...input,
            payload: {
              ...input.payload,
              output_config: format
                ? { ...input.payload.output_config, format }
                : input.payload.output_config
            }
          })
      } satisfies typeof client;
    })
  ).pipe(Layer.provide(providerHttpLayer(options, 'x-api-key')));

  return Object.assign(
    withProviderTools(
      Model.make(
        'anthropic' as string,
        options.modelId,
        AnthropicLanguageModel.layer({ model: options.modelId }).pipe(Layer.provide(clientLayer))
      ),
      { web_search: AnthropicTool.WebSearch_20250305({}) }
    ),
    {
      withOutputSchema: (schema: Schema.Top & Schema.ConstraintDecoder<unknown>) => ({
        model: createAnthropicModel({ ...options, outputSchema: schema }),
        codec: AnthropicStructuredOutput.toCodecAnthropic(schema).codec
      })
    }
  );
}
