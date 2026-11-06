/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Supports scoped semantic retrieval through canonical contracts and real            │
 * │ integration checks.                                                                      │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Preserves canonical identities and validates bounded search capability behavior.       │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Feature projections own content visibility and runtime registration remains an explicit  │
 * │ caller decision.                                                                         │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { StudyError } from '@study/contracts/errors';
import {
  searchProjectionPageInputSchema,
  searchProjectionPageSchema
} from '@study/contracts/search/schemas';

import type { SearchProjection } from './types.ts';

/** Share bounded lookahead and validation, while features retain their SQL and visibility. */
export function searchProjectionPageQuery(
  read: (input: typeof searchProjectionPageInputSchema.Type) => readonly SearchProjection[],
  requiresKind = false
) {
  return {
    role: 'collection' as const,
    input: searchProjectionPageInputSchema,
    output: searchProjectionPageSchema,
    run: (input: typeof searchProjectionPageInputSchema.Type) => {
      if (requiresKind && input.kind === undefined)
        throw new StudyError('invalid_input', 'A search entity kind is required');

      const rows = read({ ...input, limit: input.limit + 1 });

      return {
        items: rows.slice(0, input.limit),
        next: rows.length > input.limit ? input.offset + input.limit : null
      };
    }
  };
}
