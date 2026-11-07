/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Defines Fireworks AI defaults and API key model construction for the shared        │
 * │ provider registry.                                                                       │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Owns Fireworks AI identity, suggested models and SDK configuration.                    │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Provider credentials are supplied by Auth; feature agents consume the shared model       │
 * │ interface.                                                                               │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { compatibleProvider } from './compatible.ts';

export const fireworks = compatibleProvider({
  id: 'fireworks',
  name: 'Fireworks AI',
  baseURL: 'https://api.fireworks.ai/inference/v1',
  models: ['accounts/fireworks/models/glm-5p3-flash', 'accounts/fireworks/models/glm-5p3'],
  defaults: {
    tiny: 'accounts/fireworks/models/glm-5p3-flash',
    medium: 'accounts/fireworks/models/glm-5p3-flash',
    smart: 'accounts/fireworks/models/glm-5p3'
  }
});
