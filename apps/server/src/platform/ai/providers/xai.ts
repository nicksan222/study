/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Defines xAI defaults and API key model construction for the shared provider        │
 * │ registry.                                                                                │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Owns xAI identity, suggested models and SDK configuration.                             │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Provider credentials are supplied by Auth; feature agents consume the shared model       │
 * │ interface.                                                                               │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { compatibleProvider } from './compatible.ts';

export const xai = compatibleProvider({
  id: 'xai',
  name: 'xAI',
  baseURL: 'https://api.x.ai/v1',
  models: ['grok-4.7'],
  defaults: {
    tiny: 'grok-4.7',
    medium: 'grok-4.7',
    smart: 'grok-4.7'
  }
});
