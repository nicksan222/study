/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Registers API key providers and exposes their public metadata without private      │
 * │ credentials.                                                                             │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Resolves validated provider identifiers and lists available provider metadata.         │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Auth and Settings consume this registry; individual modules own provider behavior.       │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { StudyError } from '@study/contracts/errors';

import { anthropic } from './anthropic.ts';
import { cerebras } from './cerebras.ts';
import { deepseek } from './deepseek.ts';
import type { ApiKeyProvider } from './definition.ts';
import { fireworks } from './fireworks.ts';
import { google } from './google.ts';
import { groq } from './groq.ts';
import { mistral } from './mistral.ts';
import { openrouter } from './openrouter.ts';
import { together } from './together.ts';
import { xai } from './xai.ts';

export const apiKeyProviders = [
  anthropic,
  google,
  openrouter,
  deepseek,
  mistral,
  groq,
  xai,
  together,
  fireworks,
  cerebras
] as const satisfies readonly ApiKeyProvider[];

export function getApiKeyProvider(id: string): ApiKeyProvider {
  const provider = apiKeyProviders.find((entry) => entry.id === id);

  if (!provider) throw new StudyError('invalid_input', 'Unknown AI provider');

  return provider;
}

export function providerCatalog() {
  return apiKeyProviders.map(({ id, name, models, defaults }) => ({ id, name, models, defaults }));
}
