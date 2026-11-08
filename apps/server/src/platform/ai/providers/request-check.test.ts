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

import { testStable } from '@study/testing/vitest';
import { expect } from 'vite-plus/test';

import { getApiKeyProvider } from './registry.ts';
import { withRequestCheck } from './request-check.ts';

testStable(
  'preflight blocks API-key model requests before the transport sees credentials',
  async () => {
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
