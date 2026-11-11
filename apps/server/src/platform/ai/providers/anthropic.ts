/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Defines Anthropic defaults and API key model construction for the shared provider  │
 * │ registry.                                                                                │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Owns Anthropic identity, suggested models and SDK configuration.                       │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Provider credentials are supplied by Auth; feature agents consume the shared model       │
 * │ interface.                                                                               │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { createAnthropic } from '@ai-sdk/anthropic';

import { defineApiKeyProvider, sdkFetch } from './definition.ts';
import { withProviderTools } from './tools.ts';

export const anthropic = defineApiKeyProvider({
  id: 'anthropic',
  name: 'Anthropic',
  models: ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5'],
  defaults: { tiny: 'claude-haiku-5-5', medium: 'claude-sonnet-5-5', smart: 'claude-opus-5-5' },
  createModel: ({ apiKey, modelId, fetch }) =>
    withProviderTools(
      createAnthropic({ apiKey, fetch: fetch ? sdkFetch(fetch) : undefined })(modelId),
      {
        web_search: createAnthropic().tools.webSearch_20250305({})
      }
    )
});
