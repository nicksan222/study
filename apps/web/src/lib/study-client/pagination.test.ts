import { Effect } from 'effect';
import { expect, it } from 'vite-plus/test';

import { collectPages } from './pagination';

it('collects pages in order, following cursors even after an empty page', async () => {
  const cursors: Array<number | undefined> = [];
  const pages = collectPages((cursor: number | undefined) =>
    Effect.sync(() => {
      cursors.push(cursor);

      return cursor === undefined
        ? { items: ['first'], next: 1 }
        : cursor === 1
          ? { items: [], next: 2 }
          : { items: ['last'], next: null };
    })
  );

  expect(await Effect.runPromise(pages)).toEqual(['first', 'last']);
  expect(await Effect.runPromise(pages)).toEqual(['first', 'last']);
  expect(cursors).toEqual([undefined, 1, 2, undefined, 1, 2]);
});

it('preserves a failed page and stops requesting subsequent pages', async () => {
  const failure = { kind: 'rate_limited' };
  const cursors: Array<number | undefined> = [];
  const result = collectPages((cursor: number | undefined) => {
    cursors.push(cursor);

    return cursor === undefined
      ? Effect.succeed({ items: ['first'], next: 1 })
      : Effect.fail(failure);
  });

  expect(await Effect.runPromise(Effect.flip(result))).toBe(failure);
  expect(cursors).toEqual([undefined, 1]);
});
