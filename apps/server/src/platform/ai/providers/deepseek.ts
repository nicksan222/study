/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Defines DeepSeek identity and API key model construction for the shared provider   │
 * │ registry.                                                                                │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Owns DeepSeek identity and provider configuration.                        │
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
  baseURL: 'https://api.deepseek.com'
});
