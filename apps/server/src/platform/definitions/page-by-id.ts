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
