/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Defines Together AI identity and API key model construction for the shared         │
 * │ provider registry.                                                                       │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Owns Together AI identity and provider configuration.                     │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Provider credentials are supplied by Auth; feature agents consume the shared model       │
 * │ interface.                                                                               │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { compatibleProvider } from './compatible.ts';

export const together = compatibleProvider({
  id: 'together',
  catalogId: 'togetherai',
  name: 'Together AI',
  baseURL: 'https://api.together.xyz/v1'
});
