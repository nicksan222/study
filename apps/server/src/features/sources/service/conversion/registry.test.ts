import { plainBlock } from '@study/contracts';
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
import { test } from '@study/testing';
import { Effect } from 'effect';

import { DEFAULT_MAX_BYTES, document } from '#server/features/sources/decoders/common';

import type { ConversionContext, ConversionInput } from './registry.ts';
import { makeConversionRegistry } from './registry.ts';

test.stable(
  'one registration exposes a strategy and routes conversions with validated output',
  async ({ expect }) => {
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
      { id: 'test', name: 'AI text conversion', supportedInputs: ['text'] }
    ]);
    expect(
      await Effect.runPromise(registry.convert('test', { kind: 'text', text: 'Original' }, context))
    ).toEqual(output);
    const missing = await Effect.runPromise(
      Effect.result(registry.convert('missing', { kind: 'text', text: 'Original' }, context))
    );

    expect(missing._tag).toBe('Failure');
    const metadata = registry.describe('test');

    metadata.supportedInputs.push('pdf');

    const unsupported = await Effect.runPromise(
      Effect.result(registry.convert('test', { kind: 'pdf', bytes: new Uint8Array() }, context))
    );

    expect(unsupported._tag).toBe('Failure');
  }
);

test.stable('a method for one input kind does not disable default PDF reading', ({ expect }) => {
  const convert = () => Effect.die('Unexpected conversion');
  const registry = makeConversionRegistry([
    { id: 'default-pdf', label: 'ConversionChatGpt', supportedInputs: ['pdf'], convert },
    { id: 'text-only', label: 'ConversionChatGpt', supportedInputs: ['text'], convert }
  ]);

  expect(registry.forInput('text-only', 'pdf').id).toBe('default-pdf');
  expect(registry.forInput('text-only', 'text').id).toBe('text-only');
  expect(() => registry.forInput('missing', 'pdf')).toThrow();
});

test.stable(
  'rejects empty or oversized inputs before invoking any conversion implementation',
  async ({ expect }) => {
    let calls = 0;
    const output = document([plainBlock('paragraph', 'Converted', { type: 'authored' })], 'text');
    const registry = makeConversionRegistry([
      {
        id: 'test',
        label: 'ConversionChatGpt',
        supportedInputs: ['text', 'pdf'],
        convert: () => {
          calls++;

          return Effect.succeed(output);
        }
      }
    ]);
    const context: ConversionContext = { generate: () => Effect.die('Unexpected model call') };
    const inputs: ConversionInput[] = [
      { kind: 'text', text: '' },
      { kind: 'text', text: '  \n ' },
      { kind: 'text', text: 'x'.repeat(100001) },
      { kind: 'pdf', bytes: new Uint8Array(DEFAULT_MAX_BYTES + 1) }
    ];

    for (const input of inputs) {
      const result = await Effect.runPromise(
        Effect.result(registry.convert('test', input, context))
      );

      expect(result._tag).toBe('Failure');
    }

    expect(calls).toBe(0);
  }
);
