/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Defines xAI identity and API key model construction for the shared provider        │
 * │ registry.                                                                                │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Owns xAI identity and provider configuration.                             │
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
  baseURL: 'https://api.x.ai/v1'
});
