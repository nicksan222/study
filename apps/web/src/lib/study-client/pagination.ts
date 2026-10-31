import { Effect, Option, Stream } from 'effect';

/** Collect a cursor API inside its caller's Effect scope. */
export function collectPages<A, Cursor, E, R>(
  fetchPage: (
    cursor: Cursor | undefined
  ) => Effect.Effect<{ readonly items: readonly A[]; readonly next: Cursor | null }, E, R>
): Effect.Effect<A[], E, R> {
  return Stream.paginate(undefined as Cursor | undefined, (cursor) =>
    fetchPage(cursor).pipe(
      Effect.map((page) => [page.items, Option.fromNullishOr(page.next)] as const)
    )
  ).pipe(Stream.runCollect);
}
