/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Verifies language detection using the real bundled offline model.                  │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Preserves source content and validates typed language results.                         │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Uses local model assets without network requests or content publication.                 │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { testStable } from '@study/testing/vitest';
import { Effect } from 'effect';
import { expect } from 'vite-plus/test';

import { decodeText } from '#server/features/sources/decoders/text';

import { withDetectedLanguage } from './language.ts';

const source = (text: string, kind: 'text' | 'code' = 'text') =>
  decodeText({
    kind,
    mime: kind === 'code' ? 'text/javascript' : 'text/plain',
    bytes: new TextEncoder().encode(text)
  });

testStable('real Tongue adds language metadata while preserving exact source blocks', async () => {
  const document = source(
    'Photosynthesis converts light energy into chemical energy in plants and algae.'
  );
  const result = await Effect.runPromise(withDetectedLanguage(document, true));

  expect(result.meta.language).toBe('en');
  expect(result.blocks).toBe(document.blocks);
  expect(result.meta.refiners).toEqual([{ refiner: 'desert-ant-tongue', version: 1 }]);
});

testStable(
  'disabled detection, code and already identified documents retain their metadata',
  async () => {
    const document = source(
      'Photosynthesis converts light energy into chemical energy in plants and algae.'
    );

    expect(await Effect.runPromise(withDetectedLanguage(document, false))).toBe(document);
    const code = source(
      'function calculateTotalPrice(items) { return items.reduce((total, item) => total + item.price, 0); }',
      'code'
    );

    expect(await Effect.runPromise(withDetectedLanguage(code, true))).toBe(code);
    const identified = { ...document, meta: { ...document.meta, language: 'it' } };

    expect(await Effect.runPromise(withDetectedLanguage(identified, true))).toBe(identified);
  }
);
