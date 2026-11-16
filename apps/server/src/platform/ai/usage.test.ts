import type { LanguageModelV3, LanguageModelV3Usage } from '@ai-sdk/provider';
/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Verifies provider independent usage normalization and model middleware behavior.   │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Checks token subsets and automatic tracking across SDK call styles.                    │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Tests use deterministic model strategies and never contact external providers.           │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */
import { agentRunIdSchema } from '@study/contracts';
import type { UsageRecord } from '@study/contracts';
import { test } from '@study/testing';

import { normalizeUsage, withUsageTracking } from './usage.ts';

const usage = (
  input: number | undefined,
  cached: number | undefined,
  output: number | undefined
): LanguageModelV3Usage => ({
  inputTokens: { total: input, noCache: undefined, cacheRead: cached, cacheWrite: undefined },
  outputTokens: { total: output, text: undefined, reasoning: 3 }
});

test.stable('cached input and reasoning remain subsets of the reported totals', () => {
  test.expect(normalizeUsage(usage(100, 80, 10))).toEqual({
    input: 100,
    cacheRead: 80,
    cacheWrite: 0,
    output: 10,
    reasoning: 3,
    incomplete: false
  });
});

test.stable(
  'unknown and inconsistent counts are marked incomplete without inventing tokens',
  () => {
    test.expect(normalizeUsage(usage(undefined, undefined, undefined)).incomplete).toBe(true);
    test.expect(normalizeUsage(usage(10, 20, -1))).toEqual({
      input: 10,
      cacheRead: 0,
      cacheWrite: 0,
      output: 0,
      reasoning: 0,
      incomplete: true
    });
  }
);

test.stable(
  'provider strategies inherit per-call tracking for streaming and generation',
  async () => {
    const records: UsageRecord[] = [];
    const counts = usage(100, 80, 10);
    const model: LanguageModelV3 = {
      specificationVersion: 'v3',
      provider: 'future-provider',
      modelId: 'future-model',
      supportedUrls: {},
      doGenerate: async () => ({
        content: [],
        finishReason: { unified: 'stop', raw: 'stop' },
        usage: counts,
        warnings: []
      }),
      doStream: async () => ({
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({
              type: 'finish',
              finishReason: { unified: 'stop', raw: 'stop' },
              usage: counts
            });
            controller.close();
          }
        })
      })
    };
    const tracked = withUsageTracking(
      model,
      { runId: agentRunIdSchema.make('run'), agent: 'reply' },
      async (record) => {
        records.push(record);
      },
      () => 123
    );
    const options = { prompt: [] };

    await tracked.doGenerate(options);
    const result = await tracked.doStream(options);
    const reader = result.stream.getReader();
    const terminal = await reader.read();

    test.expect(terminal.value?.type).toBe('finish');
    test.expect(records).toHaveLength(2);
    test.expect(new Set(records.map((record) => record.id)).size).toBe(2);
    test.expect(records[1]).toMatchObject({
      provider: 'future-provider',
      model: 'future-model',
      input: 100,
      output: 10,
      agent: 'reply',
      timestamp: 123
    });
    await reader.read();
  }
);
