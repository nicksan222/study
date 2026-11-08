/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Defines DeepSeek defaults and API key model construction for the shared provider   │
 * │ registry.                                                                                │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Owns DeepSeek identity, suggested models and SDK configuration.                        │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Provider credentials are supplied by Auth; feature agents consume the shared model       │
 * │ interface.                                                                               │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { compatibleProvider } from './compatible.ts';

export const deepseek = compatibleProvider({
  id: 'deepseek',
  name: 'DeepSeek',
  baseURL: 'https://api.deepseek.com',
  models: ['deepseek-flash', 'deepseek-v4-pro'],
  defaults: { tiny: 'deepseek-flash', medium: 'deepseek-flash', smart: 'deepseek-v4-pro' }
});
