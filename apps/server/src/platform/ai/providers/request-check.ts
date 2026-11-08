/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Fences AI SDK model calls with workflow ownership checks before sending provider   │
 * │ requests.                                                                                │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Preserves transport checks and wraps generic model generation and streaming.           │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Workflow owners supply preflight checks; provider modules retain transport specific      │
 * │ behavior.                                                                                │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import type { LanguageModelV3 } from '@ai-sdk/provider';

type RequestCheck = (signal: AbortSignal | undefined) => Promise<void>;

interface CheckedModel extends LanguageModelV3 {
  withRequestCheck(check: RequestCheck): LanguageModelV3;
}

export function withRequestCheck(model: LanguageModelV3, check: RequestCheck): LanguageModelV3 {
  if ('withRequestCheck' in model && typeof model.withRequestCheck === 'function')
    return (model as CheckedModel).withRequestCheck(check);

  return {
    specificationVersion: model.specificationVersion,
    provider: model.provider,
    modelId: model.modelId,
    supportedUrls: model.supportedUrls,
    async doGenerate(options) {
      await check(options.abortSignal);

      return model.doGenerate(options);
    },
    async doStream(options) {
      await check(options.abortSignal);

      return model.doStream(options);
    }
  };
}
