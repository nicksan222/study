/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Adapts canonical provider usage into durable per-call accounting records.          │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Wraps SDK generation and streams without retaining model content.                      │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Provider implementations own token semantics; observability receives normalized          │
 * │ metadata only.                                                                           │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import type { LanguageModelV3, LanguageModelV3Usage } from '@ai-sdk/provider';
import type { UsageRecord } from '@study/contracts/settings/usage';
import { wrapLanguageModel } from 'ai';

/** SDK provider implementations are the strategies; accounting only consumes their canonical usage. */
export function normalizeUsage(usage: LanguageModelV3Usage) {
  let incomplete = false;
  const count = (value: number | undefined, required = false) => {
    if (value === undefined && !required) return 0;

    if (value === undefined || !Number.isSafeInteger(value) || value < 0) {
      incomplete = true;

      return 0;
    }

    return value;
  };
  const input = count(usage.inputTokens.total, true);
  const output = count(usage.outputTokens.total, true);
  let cacheRead = count(usage.inputTokens.cacheRead);
  let cacheWrite = count(usage.inputTokens.cacheWrite);
  let reasoning = count(usage.outputTokens.reasoning);

  if (cacheRead + cacheWrite > input) {
    cacheRead = 0;
    cacheWrite = 0;
    incomplete = true;
  }

  if (reasoning > output) {
    reasoning = 0;
    incomplete = true;
  }

  return { input, cacheRead, cacheWrite, output, reasoning, incomplete };
}

/** Record each completed provider call before forwarding its finish, including tool steps and rejected outputs. */
export function withUsageTracking(
  model: LanguageModelV3,
  context: Pick<UsageRecord, 'runId' | 'agent'>,
  record: (usage: UsageRecord) => Promise<void>,
  now: () => number
): LanguageModelV3 {
  const save = (id: string, usage: LanguageModelV3Usage) =>
    record({
      ...context,
      id,
      provider: model.provider,
      model: model.modelId,
      timestamp: now(),
      ...normalizeUsage(usage)
    });

  return wrapLanguageModel({
    model,
    middleware: {
      specificationVersion: 'v3',
      wrapGenerate: async ({ doGenerate }) => {
        const id = crypto.randomUUID();
        const result = await doGenerate();

        await save(id, result.usage);

        return result;
      },
      wrapStream: async ({ doStream }) => {
        const id = crypto.randomUUID();
        const result = await doStream();
        let recorded = false;

        return {
          ...result,
          stream: result.stream.pipeThrough(
            new TransformStream({
              async transform(part, controller) {
                if (part.type === 'finish' && !recorded) {
                  recorded = true;
                  await save(id, part.usage);
                }

                controller.enqueue(part);
              }
            })
          )
        };
      }
    }
  });
}
