/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Defines Google Gemini defaults and API key model construction for the shared       │
 * │ provider registry.                                                                       │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Owns Google Gemini identity, suggested models and SDK configuration.                   │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Provider credentials are supplied by Auth; feature agents consume the shared model       │
 * │ interface.                                                                               │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { createGoogleGenerativeAI } from '@ai-sdk/google';

import { defineApiKeyProvider, sdkFetch } from './definition.ts';
import { withProviderTools } from './tools.ts';

export const google = defineApiKeyProvider({
  id: 'google',
  name: 'Google Gemini',
  models: ['gemini-3.5-flash-lite', 'gemini-3.8-flash'],
  defaults: {
    tiny: 'gemini-3.5-flash-lite',
    medium: 'gemini-3.8-flash',
    smart: 'gemini-3.8-flash'
  },
  createModel: ({ apiKey, modelId, fetch }) =>
    withProviderTools(
      createGoogleGenerativeAI({ apiKey, fetch: fetch ? sdkFetch(fetch) : undefined })(modelId),
      {
        web_search: createGoogleGenerativeAI().tools.googleSearch({})
      },
      modelId.startsWith('gemini-3')
    )
});
