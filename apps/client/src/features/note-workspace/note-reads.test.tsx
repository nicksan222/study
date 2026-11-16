import { noteIdSchema, projectIdSchema, notePageInputSchema } from '@study/contracts';
import { test } from '@study/testing';
import { Schema } from 'effect';

import { useNoteList } from './note-reads';

/** Interaction-level coverage; authoritative membership and transaction races are server tests. */
test.stable(
  'keeps loaded note windows bounded, navigates beyond one hundred and resets on owner changes',
  async () => {
    const items = Array.from({ length: 150 }, (_, index) => {
      const value = BigInt(150 - index);

      return {
        id: noteIdSchema.make(value),
        title: `Note ${value}`,
        titleSource: 'user',
        projectIds: [],
        archivedAt: null,
        createdAt: value,
        updatedAt: value
      };
    });
    const reads: (typeof notePageInputSchema.Type)[] = [];
    const fixture = test.rpcTestTransport(async (_tag, input) => {
      const request = Schema.decodeUnknownSync(notePageInputSchema)(input);

      reads.push(request);
      const matches = items.filter((item) => !request.before || item.id < request.before.id);
      const selected = matches.slice(0, request.limit);
      const last = selected.at(-1);

      return {
        items: selected,
        next:
          matches.length > selected.length && last
            ? { id: last.id, updatedAt: last.updatedAt }
            : null
      };
    });
    const view = test.renderHook(({ project }) => useNoteList(project), {
      wrapper: fixture.wrapper,
      initialProps: { project: projectIdSchema.make(1n) }
    });

    await test.waitFor(() => test.expect(view.result.current.data?.items).toHaveLength(30));

    for (const limit of [60, 90, 100]) {
      test.act(() => view.result.current.fetchNextPage());
      await test.waitFor(() => test.expect(view.result.current.data?.items).toHaveLength(limit));
    }

    test.act(() => view.result.current.fetchNextPage());
    await test.waitFor(() =>
      test.expect(view.result.current.data?.items[0]?.id).toBe(noteIdSchema.make(50n))
    );
    test.expect(view.result.current.pagination.hasPrevious).toBe(true);
    test.act(() => view.result.current.pagination.previous());
    await test.waitFor(() =>
      test.expect(view.result.current.data?.items[0]?.id).toBe(noteIdSchema.make(150n))
    );
    view.rerender({ project: projectIdSchema.make(2n) });
    await test.waitFor(() => test.expect(reads.at(-1)?.project).toBe(projectIdSchema.make(2n)));
    test.expect(reads.at(-1)?.before).toBeUndefined();
    test.expect(reads.at(-1)?.limit).toBe(30);
    test.expect(reads.every((request) => request.limit <= 100)).toBe(true);
  }
);
