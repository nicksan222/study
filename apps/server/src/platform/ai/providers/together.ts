/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Defines Together AI defaults and API key model construction for the shared         │
 * │ provider registry.                                                                       │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Owns Together AI identity, suggested models and SDK configuration.                     │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Provider credentials are supplied by Auth; feature agents consume the shared model       │
 * │ interface.                                                                               │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { compatibleProvider } from './compatible.ts';

export const together = compatibleProvider({
  id: 'together',
  name: 'Together AI',
  baseURL: 'https://api.together.xyz/v1',
  models: ['Qwen/Qwen3.8-Flash', 'deepseek-ai/DeepSeek-V4.1-Flash', 'openai/gpt-oss-120b'],
  defaults: {
    tiny: 'Qwen/Qwen3.8-Flash',
    medium: 'deepseek-ai/DeepSeek-V4.1-Flash',
    smart: 'openai/gpt-oss-120b'
  }
});
