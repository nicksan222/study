/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Defines Cerebras defaults and API key model construction for the shared provider   │
 * │ registry.                                                                                │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Owns Cerebras identity, suggested models and SDK configuration.                        │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Provider credentials are supplied by Auth; feature agents consume the shared model       │
 * │ interface.                                                                               │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { compatibleProvider } from './compatible.ts';

export const cerebras = compatibleProvider({
  id: 'cerebras',
  name: 'Cerebras',
  baseURL: 'https://api.cerebras.ai/v1',
  models: ['qwen-3.8-27b', 'gpt-oss-120b'],
  defaults: { tiny: 'qwen-3.8-27b', medium: 'qwen-3.8-27b', smart: 'gpt-oss-120b' }
});
