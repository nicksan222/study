/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Supplies canonical document fixtures for document processing behavior tests.       │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Creates original canonical blocks with explicit authored source anchors.               │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Fixtures serve tests only and never provide production execution or persistence.         │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import type { Document } from '@study/contracts/sources/document';
import { plainBlock } from '@study/contracts/sources/document';

export function document(texts: string[]): Document {
  return {
    blocks: texts.map((text) => plainBlock('paragraph', text, { type: 'authored' })),
    meta: {
      extractor: null,
      extractorVersion: 1,
      provider: null,
      durationMs: null,
      pageCount: null,
      refiners: [],
      waitingFor: [],
      corrected: false,
      omissions: []
    }
  };
}
