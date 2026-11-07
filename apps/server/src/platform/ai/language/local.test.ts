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

import { detectTextLanguage } from './local.ts';

testStable(
  'real bundled Tongue identifies English and Italian prose without network access',
  async () => {
    expect(
      await Effect.runPromise(
        detectTextLanguage(
          'Photosynthesis converts light energy into chemical energy in plants and algae.'
        )
      )
    ).toBe('en');
    expect(
      await Effect.runPromise(
        detectTextLanguage(
          'La fotosintesi trasforma la luce in energia chimica nelle piante e nelle alghe.'
        )
      )
    ).toBe('it');
  }
);

testStable(
  'language detection leaves short, ambiguous and nonlinguistic inputs unknown',
  async () => {
    for (const text of ['', 'la casa', '2026 12345 67890', 'Samsung Galaxy'])
      expect(await Effect.runPromise(detectTextLanguage(text))).toBeNull();
  }
);
