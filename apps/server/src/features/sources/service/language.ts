/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Enriches source metadata without changing captured words or anchors.               │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Preserves source content and validates typed language results.                         │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Uses local model assets without network requests or content publication.                 │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import type { Document } from '@study/contracts/sources/document';
import { Effect } from 'effect';

import { detectTextLanguage } from '#server/platform/ai/language/local';

const prose = new Set(['paragraph', 'heading', 'segment', 'list_item', 'reference']);

export const withDetectedLanguage = (document: Document, enabled: boolean) =>
  Effect.gen(function* () {
    if (!enabled || document.meta.language) return document;

    let sample = '';

    for (const block of document.blocks) {
      if (!prose.has(block.kind)) continue;

      sample += `${block.text}\n`.slice(0, 512 - sample.length);

      if (sample.length >= 512) break;
    }

    const language = yield* detectTextLanguage(sample);

    if (language === null) return document;

    return {
      ...document,
      meta: {
        ...document.meta,
        language,
        refiners: [...document.meta.refiners, { refiner: 'desert-ant-tongue', version: 1 }]
      }
    };
  });
