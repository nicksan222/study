/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Defines OpenRouter defaults and API key model construction for the shared provider │
 * │ registry.                                                                                │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Owns OpenRouter identity, suggested models and SDK configuration.                      │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Provider credentials are supplied by Auth; feature agents consume the shared model       │
 * │ interface.                                                                               │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { compatibleProvider } from './compatible.ts';

export const openrouter = compatibleProvider({
  id: 'openrouter',
  name: 'OpenRouter',
  baseURL: 'https://openrouter.ai/api/v1',
  models: [
    'anthropic/claude-haiku-5.5',
    'anthropic/claude-sonnet-5.5',
    'anthropic/claude-opus-5.5'
  ],
  defaults: {
    tiny: 'anthropic/claude-haiku-5.5',
    medium: 'anthropic/claude-sonnet-5.5',
    smart: 'anthropic/claude-opus-5.5'
  }
});
