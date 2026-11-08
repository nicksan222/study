/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Resolves current API credentials before model calls without retaining queued       │
 * │ secrets.                                                                                 │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Constructs fresh provider models for generation and streaming requests.                │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Auth supplies current credentials; provider modules own transport and feature agents own │
 * │ tasks.                                                                                   │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import type { LanguageModelV3, LanguageModelV3CallOptions } from '@ai-sdk/provider';

import { streamingFetch } from '#server/platform/http/index';

import type { ApiKeyProvider } from './definition.ts';

/** A queued or multi-step run reads its current key immediately before every SDK call. */
export function createApiKeyModel(
  provider: ApiKeyProvider,
  modelId: string,
  apiKey: (signal?: AbortSignal) => Promise<string>,
  fetch?: typeof globalThis.fetch
): LanguageModelV3 {
  const request: typeof globalThis.fetch = (input, init) =>
    streamingFetch(input, init, {
      fetch,
      timeoutMs: 120_000,
      maxBytes: 32 * 1024 * 1024
    });
  const metadata = provider.createModel({ apiKey: 'unconfigured', modelId, fetch: request });
  const current = async (signal?: AbortSignal) =>
    provider.createModel({ apiKey: await apiKey(signal), modelId, fetch: request });

  return Object.assign(metadata, {
    doGenerate: async (options: LanguageModelV3CallOptions) =>
      (await current(options.abortSignal)).doGenerate(options),
    doStream: async (options: LanguageModelV3CallOptions) =>
      (await current(options.abortSignal)).doStream(options)
  });
}
