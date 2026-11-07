/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Validates matching associations and reads private attempt snapshots.               │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Checks complete permutations and keeps correct associations private.                   │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Private learning stores own matching behavior inside caller transactions.                │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import type { MatchingDefinitionId } from '@study/contracts/ids';
import { matchingAssociationsSchema } from '@study/contracts/learning/schemas';
import type { matchingPairsSchema } from '@study/contracts/materials/schemas';
import { Schema } from 'effect';

import { invalid } from '#server/platform/errors/domain-error';

type Pairs = typeof matchingPairsSchema.Type;

type Associations = typeof matchingAssociationsSchema.Type;

const codec = Schema.fromJsonString(matchingAssociationsSchema);

export const encodeAssociations = Schema.encodeSync(codec);

export const decodeAssociations = Schema.decodeUnknownSync(codec);

/** Require a question-owned bijection and award equal credit to each correct pair. */
export function matchingScore(pairs: Pairs, associations: Associations) {
  if (
    associations.length !== pairs.length ||
    new Set(associations.map((a) => a.termId)).size !== pairs.length ||
    new Set(associations.map((a) => a.definitionId)).size !== pairs.length ||
    associations.some(
      (a) =>
        !pairs.some((p) => p.termId === a.termId) ||
        !pairs.some((p) => p.definitionId === a.definitionId)
    )
  )
    invalid('matching response must be a complete permutation of this question');

  return (
    pairs.filter((p) =>
      associations.some((a) => a.termId === p.termId && a.definitionId === p.definitionId)
    ).length / pairs.length
  );
}

/** Expose terms and shuffled definitions separately, withholding their canonical associations. */
export function matchingView(pairs: Pairs, order: MatchingDefinitionId[], answer: string | null) {
  return {
    kind: 'matching' as const,
    terms: pairs.map((p) => ({ id: p.termId, text: p.term })),
    definitions: order.map((id) => {
      const pair = pairs.find((p) => p.definitionId === id);

      if (!pair) return invalid('invalid matching attempt snapshot');

      return { id, text: pair.definition };
    }),
    answer:
      answer === null
        ? null
        : { type: 'matching' as const, associations: decodeAssociations(answer) }
  };
}
