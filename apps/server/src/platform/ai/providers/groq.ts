/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Defines Groq defaults and API key model construction for the shared provider       │
 * │ registry.                                                                                │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Owns Groq identity, suggested models and SDK configuration.                            │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Provider credentials are supplied by Auth; feature agents consume the shared model       │
 * │ interface.                                                                               │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { compatibleProvider } from './compatible.ts';

export const groq = compatibleProvider({
  id: 'groq',
  name: 'Groq',
  baseURL: 'https://api.groq.com/openai/v1',
  models: ['openai/gpt-oss-20b', 'openai/gpt-oss-120b'],
  defaults: {
    tiny: 'openai/gpt-oss-20b',
    medium: 'openai/gpt-oss-120b',
    smart: 'openai/gpt-oss-120b'
  }
});
