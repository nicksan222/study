/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Defines Mistral AI defaults and API key model construction for the shared provider │
 * │ registry.                                                                                │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Owns Mistral AI identity, suggested models and SDK configuration.                      │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Provider credentials are supplied by Auth; feature agents consume the shared model       │
 * │ interface.                                                                               │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { compatibleProvider } from './compatible.ts';

export const mistral = compatibleProvider({
  id: 'mistral',
  name: 'Mistral AI',
  baseURL: 'https://api.mistral.ai/v1',
  models: ['mistral-small-latest', 'mistral-large-latest'],
  defaults: {
    tiny: 'mistral-small-latest',
    medium: 'mistral-small-latest',
    smart: 'mistral-large-latest'
  }
});
