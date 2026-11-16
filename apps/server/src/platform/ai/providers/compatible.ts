/** @file Constructs native Effect adapters for Chat Completions providers. */
import { OpenAiClient, OpenAiLanguageModel } from '@effect/ai-openai-compat';
import { Effect, Layer } from 'effect';
import type { Schema } from 'effect';
import { Model, OpenAiStructuredOutput } from 'effect/ai';

import type { AiModel } from '#server/platform/ai/model';

import { defineApiKeyProvider } from './definition.ts';
import type { ProviderDefinition } from './definition.ts';
import { providerHttpLayer } from './transport.ts';

export function compatibleProvider<
  const Id extends string,
  const Models extends readonly [string, ...string[]]
>(definition: Omit<ProviderDefinition<Id, Models>, 'createModel'> & { baseURL: string }) {
  const { baseURL, ...metadata } = definition;

  return defineApiKeyProvider({
    ...metadata,
    createModel: (options): AiModel => {
      const clientLayer = Layer.effect(
        OpenAiClient.OpenAiClient,
        Effect.gen(function* () {
          const client = yield* OpenAiClient.make({ apiUrl: baseURL });
          const prepare = <
            T extends { readonly response_format?: unknown; readonly messages?: unknown }
          >(
            input: T
          ): T => {
            const format = options.outputSchema
              ? {
                  type: 'json_schema',
                  json_schema: {
                    schema: OpenAiStructuredOutput.toCodecOpenAI(options.outputSchema).jsonSchema
                  }
                }
              : input.response_format;

            if (
              !format ||
              typeof format !== 'object' ||
              !('type' in format) ||
              format.type !== 'json_schema' ||
              !('json_schema' in format)
            )
              return input;

            const envelope = format.json_schema;

            if (!isJsonSchemaEnvelope(envelope)) return input;

            return Object.assign({}, input, {
              response_format: { type: 'json_object' },
              messages: [
                {
                  role: 'system',
                  content: `Respond with a JSON object matching this JSON Schema. Do not wrap it in Markdown.\n${JSON.stringify(envelope.schema)}`
                },
                ...(Array.isArray(input.messages) ? input.messages : [])
              ]
            });
          };

          return {
            ...client,
            createResponse: (input) => client.createResponse(prepare(input)),
            createResponseStream: (input) => client.createResponseStream(prepare(input))
          } satisfies typeof client;
        })
      ).pipe(Layer.provide(providerHttpLayer(options)));

      return Object.assign(
        Model.make(
          metadata.id as string,
          options.modelId,
          OpenAiLanguageModel.layer({ model: options.modelId }).pipe(Layer.provide(clientLayer))
        ),
        {
          withOutputSchema: (schema: Schema.Top & Schema.ConstraintDecoder<unknown>) => ({
            model: compatibleProvider(definition).createModel({ ...options, outputSchema: schema }),
            codec: OpenAiStructuredOutput.toCodecOpenAI(schema).codec
          })
        }
      );
    }
  });
}

function isJsonSchemaEnvelope(value: unknown): value is { readonly schema: unknown } {
  return value !== null && typeof value === 'object' && 'schema' in value;
}
