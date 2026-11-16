import { test } from '@study/testing';
/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Checks ownership preflight for both API key model generation and streaming         │
 * │ requests.                                                                                │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Verifies rejected ownership checks prevent credential bearing transport requests.      │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ The real SDK adapter is wrapped before either model call reaches its transport.          │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { getApiKeyProvider } from './registry.ts';
import { withRequestCheck } from './request-check.ts';

test.unit.stable(
  'preflight blocks API-key model requests before the transport sees credentials',
  async ({ expect }) => {
    let requests = 0;
    const model = getApiKeyProvider('deepseek').createModel({
      apiKey: 'test-secret',
      modelId: 'deepseek-chat',
      fetch: async () => {
        requests++;

        throw new Error('unexpected transport');
      }
    });
    const checked = withRequestCheck(model, async () => {
      throw new Error('ownership lost');
    });

    await expect(checked.doStream({ prompt: [] })).rejects.toThrow('ownership lost');
    await expect(checked.doGenerate({ prompt: [] })).rejects.toThrow('ownership lost');
    expect(requests).toBe(0);
  }
);
