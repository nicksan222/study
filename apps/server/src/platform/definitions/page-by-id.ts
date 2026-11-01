/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Pages a descending ID query with one-row lookahead when the requested page is      │
 * │ full. The returned cursor marks the last included item only when another row exists.     │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Exports pageById. The returned cursor marks the last included item only when another   │
 * │   row exists.                                                                            │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Feature modules use this typed declaration helper; it checks contracts but leaves domain │
 * │ data and business policy in the feature.                                                 │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { Effect } from 'effect';

/** Preserve ID-based paging with a one-row lookahead only when the page is full. */
export function pageById<A extends { readonly id: unknown }, E, R>(
  query: (input: { limit: number; before?: NoInfer<A['id']> }) => Effect.Effect<readonly A[], E, R>,
  input: { limit: number; before?: NoInfer<A['id']> }
): Effect.Effect<{ items: readonly A[]; next: A['id'] | null }, E, R> {
  return Effect.gen(function* () {
    const items = yield* query(input);
    const last = items.at(-1);
    const more =
      last && items.length === input.limit ? yield* query({ limit: 1, before: last.id }) : [];

    return { items, next: more.length && last ? last.id : null };
  });
}
