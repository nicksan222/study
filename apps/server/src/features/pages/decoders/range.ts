/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Validates canonical Unicode text ranges against exact Page block identities.       │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Validates canonical Unicode text ranges against exact Page block identities.           │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Pure schema and content validation grants no persistence or publication authority.       │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { validBlockTextRange } from '@study/contracts/sources/document';
import type { documentSchema, blockIdSchema } from '@study/contracts/sources/schemas';

/** Canonical ranges use UTF-16 code units and may not split a surrogate pair. */
export function validRange(
  document: typeof documentSchema.Type,
  range: {
    readonly blockId: typeof blockIdSchema.Type;
    readonly start: number;
    readonly end: number;
  },
  quote?: string
) {
  if (range.end <= range.start || !validBlockTextRange(document, range)) return false;

  return (
    quote === undefined ||
    document.blocks.some(
      (block) =>
        block.id === range.blockId && block.text.slice(range.start, range.end).includes(quote)
    )
  );
}
