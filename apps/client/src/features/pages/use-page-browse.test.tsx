import { projectIdSchema, summarySchema } from '@study/contracts';
import type { rpc } from '@study/contracts/react';
import { test } from '@study/testing';
import { Schema } from 'effect';

import { usePageBrowse } from './use-page-browse';

test.stable(
  'changing the page browser owner discards a slower previous-owner snapshot',
  async ({ vi, rpcHandlersTransport, renderHook, waitFor, expect, act }) => {
    const first = projectIdSchema.make(1n);
    const second = projectIdSchema.make(2n);
    const page = (id: bigint) =>
      Schema.decodeUnknownSync(summarySchema)({
        id,
        title: `Page ${id}`,
        description: null,
        projectIds: [id],
        createdAt: 1n,
        updatedAt: 1n,
        archivedAt: null,
        headVersionId: id
      });
    let release!: () => void;
    const slow = new Promise<void>((resolve) => {
      release = resolve;
    });
    const read = vi.fn(async (input: Parameters<typeof rpc.pages.list.read>[0]) => {
      if (input.projectId === first) await slow;

      return { items: [page(input.projectId ?? second)], nextCursor: null };
    });
    const harness = rpcHandlersTransport({ 'pages.pages': read });
    const view = renderHook(({ project }) => usePageBrowse(project), {
      initialProps: { project: first },
      wrapper: harness.wrapper
    });

    await waitFor(() =>
      expect(read).toHaveBeenCalledWith(expect.objectContaining({ projectId: first }))
    );
    view.rerender({ project: second });
    await waitFor(() => expect(view.result.current.query.data?.items[0]?.title).toBe('Page 2'));
    await act(async () => {
      release();
      await slow;
    });
    expect(view.result.current.query.data?.items[0]?.title).toBe('Page 2');
    expect(view.result.current.navigation.cursor).toBeUndefined();
    expect(view.result.current.navigation.limit).toBe(30);
  }
);
