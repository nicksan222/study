/** @file Normalizes native provider token usage for durable per-round accounting. */

import type { Response } from 'effect/ai';

/** Native provider implementations are the strategies; accounting only consumes their canonical usage. */
export function normalizeUsage(usage: Response.Usage) {
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
