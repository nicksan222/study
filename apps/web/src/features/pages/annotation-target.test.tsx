import { StudyError } from '@study/contracts/errors';
import { testStable } from '@study/testing/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { expect, vi } from 'vite-plus/test';

import { request } from '#web/lib/study-client/request.ts';

import { authoredPage } from '../document-editing/test-support';
import { releaseBodyPreviews } from '../document-presentation/body-cache';
import { TargetPicker, EvidenceTarget } from './annotation-target';
import { annotationPageOptions, retainedRangeOptions } from './annotation-target.queries';
vi.mock('#web/lib/i18n.tsx', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock('#web/lib/study-client/request.ts', () => ({ request: vi.fn() }));

function setup(rpc: object, child: ReactNode) {
  vi.mocked(request).mockImplementation((invoke) => invoke(rpc as never) as never);

  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      {child}
    </QueryClientProvider>
  );
}

testStable('selects one canonical block and rejects a split UTF-16 surrogate pair', async () => {
  const owner = authoredPage(41n, 'A😀BC', 101n);
  const doc = owner.version!;
  const pick = vi.fn();

  setup(
    {
      'pages.versions': () => Promise.resolve({ items: [], nextCursor: null }),
      'pages.version': () => Promise.resolve(doc)
    },
    <TargetPicker pageId={owner.id} initialVersion={doc.id} onPick={pick} />
  );
  await userEvent.setup().click(await screen.findByLabelText('PageBlock'));
  await userEvent.setup().click(await screen.findByRole('option', { name: '1 · A😀BC' }));
  const field = screen.getByLabelText('PageSelectPassage') as HTMLTextAreaElement;

  field.setSelectionRange(1, 2);
  fireEvent.select(field);
  expect(pick).toHaveBeenLastCalledWith(undefined);
  field.setSelectionRange(1, 3);
  fireEvent.select(field);
  expect(pick).toHaveBeenLastCalledWith({
    pageId: owner.id,
    range: {
      versionId: doc.id,
      snapshotId: doc.snapshotId,
      blockId: doc.document.blocks[0]!.id,
      start: 1,
      end: 3
    }
  });
  expect(screen.getByLabelText('AnnotationPreview')).toHaveTextContent('😀');
});

testStable('does not show current text when retained document identity differs', async () => {
  const owner = authoredPage(41n, 'Retained', 101n);
  const doc = owner.version!;
  const target = {
    pageId: owner.id,
    range: {
      versionId: doc.id,
      snapshotId: doc.snapshotId,
      blockId: doc.document.blocks[0]!.id,
      start: 0,
      end: 4
    }
  };
  const read = vi.fn().mockResolvedValue(authoredPage(41n, 'Wrong current text', 102n).version!);

  setup(
    {
      'pages.version': read
    },
    <EvidenceTarget reference={{ kind: 'range', target }} />
  );
  await userEvent.setup().click(screen.getByText('AnnotationOpenTarget'));
  await waitFor(() => expect(read).toHaveBeenCalledWith({ id: doc.id }));
  expect(await screen.findByText('ReaderUnavailable')).toBeInTheDocument();
  expect(screen.queryByText('Wrong current text')).not.toBeInTheDocument();
});

for (const component of ['evidence', 'picker'] as const)
  testStable(
    `hides cached ${component} body and selected preview after an unavailable exact read`,
    async () => {
      const doc = authoredPage(41n, 'Private retired evidence', 91n).version!;
      const target = {
        pageId: doc.pageId,
        range: {
          versionId: doc.id,
          snapshotId: doc.snapshotId,
          blockId: doc.document.blocks[0]!.id,
          start: 0,
          end: 7
        }
      };
      const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      const options =
        component === 'evidence'
          ? retainedRangeOptions(target)
          : annotationPageOptions(doc.pageId, doc.id);

      cache.setQueryData(
        options.queryKey,
        component === 'evidence' ? 'Private retired evidence' : doc
      );
      vi.mocked(request).mockRejectedValue(new StudyError('not_found', 'Body retired'));
      const view = render(
        <QueryClientProvider client={cache}>
          {component === 'evidence' ? (
            <EvidenceTarget reference={{ kind: 'range', target }} preview />
          ) : (
            <TargetPicker pageId={doc.pageId} initialVersion={doc.id} onPick={vi.fn()} />
          )}
        </QueryClientProvider>
      );

      await act(async () => {
        await cache.invalidateQueries({ queryKey: options.queryKey });
      });
      await waitFor(() => expect(cache.getQueryState(options.queryKey)?.status).toBe('error'));
      expect(screen.queryByText('retired evidence', { exact: false })).toBeNull();
      expect(screen.queryByRole('textbox')).toBeNull();
      view.unmount();
      cache.clear();
    }
  );

testStable(
  'releases a mounted retained excerpt and prevents inactive reentry after retirement',
  async () => {
    const doc = authoredPage(41n, 'Private retired evidence', 91n).version!;
    const target = {
      pageId: doc.pageId,
      range: {
        versionId: doc.id,
        snapshotId: doc.snapshotId,
        blockId: doc.document.blocks[0]!.id,
        start: 0,
        end: 7
      }
    };
    const cache = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } }
    });

    cache.setQueryData(retainedRangeOptions(target).queryKey, 'Private retired evidence');
    vi.mocked(request).mockRejectedValue(new StudyError('not_found', 'Body retired'));
    const child = (
      <QueryClientProvider client={cache}>
        <EvidenceTarget reference={{ kind: 'range', target }} preview />
      </QueryClientProvider>
    );
    const view = render(child);

    expect(screen.getByText('retired evidence', { exact: false })).toBeVisible();
    await act(async () => {
      await releaseBodyPreviews(cache, {
        kind: 'page',
        pageId: String(doc.pageId),
        versionIds: [String(doc.id)]
      });
    });
    await waitFor(() =>
      expect(screen.queryByText('retired evidence', { exact: false })).toBeNull()
    );
    view.unmount();
    const reopened = render(child);

    await screen.findByText('ReaderUnavailable');
    expect(screen.queryByText('retired evidence', { exact: false })).toBeNull();
    reopened.unmount();
    cache.clear();
  }
);
