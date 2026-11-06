/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Tests conversion discovery and dispatch through one registry registration.         │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Checks supported inputs and rejects unavailable conversion strategies.                 │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Tests use deterministic strategies without invoking any external model providers.        │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { plainBlock } from '@study/contracts/sources/document';
import { testStable } from '@study/testing/vitest';
import { Effect } from 'effect';
import { expect } from 'vite-plus/test';

import { document } from '#server/features/sources/decoders/common';

import type { ConversionContext } from './registry.ts';
import { makeConversionRegistry } from './registry.ts';

testStable(
  'one registration exposes a strategy and routes conversions with validated output',
  async () => {
    const context: ConversionContext = { generate: () => Effect.die('Unexpected model call') };
    const output = document([plainBlock('paragraph', 'Converted', { type: 'authored' })], 'text');
    const registry = makeConversionRegistry([
      {
        id: 'test',
        label: 'ConversionChatGpt',
        supportedInputs: ['text'],
        convert: () => Effect.succeed(output)
      }
    ]);

    expect(registry.list('english')).toEqual([
      { id: 'test', name: 'ChatGPT', supportedInputs: ['text'] }
    ]);
    expect(
      await Effect.runPromise(registry.convert('test', { kind: 'text', text: 'Original' }, context))
    ).toEqual(output);
    const missing = await Effect.runPromise(
      Effect.result(registry.convert('missing', { kind: 'text', text: 'Original' }, context))
    );

    expect(missing._tag).toBe('Failure');
    const unsupported = await Effect.runPromise(
      Effect.result(registry.convert('test', { kind: 'pdf', bytes: new Uint8Array() }, context))
    );

    expect(unsupported._tag).toBe('Failure');
  }
);

testStable('a method for one input kind does not disable default PDF reading', () => {
  const convert = () => Effect.die('Unexpected conversion');
  const registry = makeConversionRegistry([
    { id: 'default-pdf', label: 'ConversionChatGpt', supportedInputs: ['pdf'], convert },
    { id: 'text-only', label: 'ConversionChatGpt', supportedInputs: ['text'], convert }
  ]);

  expect(registry.forInput('text-only', 'pdf').id).toBe('default-pdf');
  expect(registry.forInput('text-only', 'text').id).toBe('text-only');
  expect(() => registry.forInput('missing', 'pdf')).toThrow();
});
