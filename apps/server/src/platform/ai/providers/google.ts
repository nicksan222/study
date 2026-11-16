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

import { defineApiKeyProvider } from './definition.ts';
import { createGoogleModel } from './google-model.ts';

export const google = defineApiKeyProvider({
  id: 'google',
  name: 'Google Gemini',
  models: ['gemini-3.5-flash-lite', 'gemini-3.8-flash'],
  defaults: {
    tiny: 'gemini-3.5-flash-lite',
    medium: 'gemini-3.8-flash',
    smart: 'gemini-3.8-flash'
  },
  createModel: createGoogleModel
});
