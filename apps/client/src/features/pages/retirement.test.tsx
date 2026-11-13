import { comparisonSchema } from '@study/contracts/pages/editing';
import { testStable } from '@study/testing/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { Schema } from 'effect';
import type { ReactNode } from 'react';
import { afterEach, expect, vi } from 'vite-plus/test';

import { authoredPage } from '../document-editing/test-support';
import { releaseBodyPreviews } from '../document-presentation/body-cache';
import { usePageRetirement } from './retirement.queries';

const rpc = vi.hoisted(() => ({ preview: vi.fn(), retire: vi.fn(), navigate: vi.fn() }));

vi.mock('#client/lib/study-client/request.ts', () => ({
  request: (invoke: (client: Record<string, unknown>) => unknown) =>
    invoke({
      'pages.previewDeletion': rpc.preview,
      'pages.delete': rpc.retire
    })
}));
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => rpc.navigate }));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

for (const uncertain of [false, true])
  testStable(
    `releases retired bodies and preserves unrelated drafts after ${uncertain ? 'an uncertain' : 'a successful'} retirement`,
    async () => {
      const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      const document = authoredPage(10n, 'Private body', 101n);
      const relatedHistory = ['pages', 'history', '10'];
      const sourceCopy = ['source-copy', '7', '8'];
      const unrelated = ['document-editor', '20', '201'];

      cache.setQueryData(relatedHistory, { pages: [{ items: [document.version] }] });
      cache.setQueryData(sourceCopy, { pending: false, page: document });
      const comparisonKey = ['pages', 'proposal-comparison', 'delete-target'];

      cache.setQueryData(
        comparisonKey,
        Schema.decodeUnknownSync(comparisonSchema)({
          beforeVersionId: document.version!.id,
          proposedVersionId: document.version!.id,
          currentVersionId: document.version!.id,
          before: document.version,
          proposed: document.version,
          current: document.version,
          proposedChanges: [],
          currentChanges: [],
          evidence: 'structural_only'
        })
      );
      cache.setQueryData(unrelated, { text: 'Keep unrelated typing' });
      rpc.preview.mockResolvedValue({
        pageId: document.id,
        token: 'exact-preview',
        versionIds: [document.version!.id],
        blockedVersionIds: [],
        semantics: 'retire_bodies_retain_identities'
      });

      if (uncertain) rpc.retire.mockRejectedValue(new Error('Lost response'));
      else rpc.retire.mockResolvedValue(undefined);

      const view = renderHook(() => usePageRetirement(document), {
        wrapper: ({ children }: { children: ReactNode }) => (
          <QueryClientProvider client={cache}>{children}</QueryClientProvider>
        )
      });

      act(() => view.result.current.open('deletion'));
      await waitFor(() => expect(view.result.current.preview?.token).toBe('exact-preview'));
      await act(async () => {
        await view.result.current.retire.mutateAsync().catch(() => undefined);
      });
      expect(cache.getQueryData(relatedHistory)).toBeUndefined();
      expect(cache.getQueryData(sourceCopy)).toBeUndefined();
      expect(cache.getQueryData(comparisonKey)).toBeUndefined();
      expect(cache.getQueryData(unrelated)).toEqual({ text: 'Keep unrelated typing' });
      view.unmount();
      cache.clear();
    }
  );

testStable(
  'purges inactive exact derived reads and body search while preserving other owners, annotation notes and unsaved drafts',
  async () => {
    const cache = new QueryClient();
    const retired = [
      ['pages', 'version', '101'],
      ['pages', 'evidence', '101'],
      ['pages', 'annotationPage', '10', '101'],
      ['pages', 'retainedRange', '10:101:501:block:0:7'],
      ['pages', 'selected-input', 'page:101'],
      ['search', { query: 'private' }],
      ['note-material-search', 'private']
    ];
    const retained = [
      ['pages', 'version', '102'],
      ['pages', 'annotationPage', '20', '201'],
      ['sources', 'selected-input', 'source:10:1:101'],
      ['pages', 'annotations', '10'],
      ['document-editor', '20', '201']
    ];

    for (const key of [...retired, ...retained])
      cache.setQueryData(key, 'Body or deliberately retained metadata');

    await releaseBodyPreviews(cache, { kind: 'page', pageId: '10', versionIds: ['101'] });

    for (const key of retired) expect(cache.getQueryData(key)).toBeUndefined();

    for (const key of retained) expect(cache.getQueryData(key)).toBeDefined();

    cache.setQueryData(['sources', 'selected-input', 'source:7:1:501'], 'Old extraction');
    cache.setQueryData(['sources', 'selected-input', 'source:7:1:502'], 'Current extraction');
    await releaseBodyPreviews(cache, { kind: 'source', sourceId: '7', snapshotIds: ['501'] });
    expect(cache.getQueryData(['sources', 'selected-input', 'source:7:1:501'])).toBeUndefined();
    expect(cache.getQueryData(['sources', 'selected-input', 'source:7:1:502'])).toBe(
      'Current extraction'
    );
    cache.clear();
  }
);
