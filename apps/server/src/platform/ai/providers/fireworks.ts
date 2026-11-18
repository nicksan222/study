/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Defines Fireworks AI identity and API key model construction for the shared        │
 * │ provider registry.                                                                       │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Owns Fireworks AI identity and provider configuration.                    │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Provider credentials are supplied by Auth; feature agents consume the shared model       │
 * │ interface.                                                                               │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { compatibleProvider } from './compatible.ts';

export const fireworks = compatibleProvider({
  id: 'fireworks',
  catalogId: 'fireworks-ai',
  name: 'Fireworks AI',
  baseURL: 'https://api.fireworks.ai/inference/v1'
});
