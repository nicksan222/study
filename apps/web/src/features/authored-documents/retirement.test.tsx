import { comparisonSchema } from '@study/contracts/documents/editing';
import { testStable } from '@study/testing/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook } from '@testing-library/react';
import { Schema } from 'effect';
import type { ReactNode } from 'react';
import { afterEach, expect, vi } from 'vite-plus/test';

import { authoredDocument } from '../document-editing/test-support';
import { releaseBodyPreviews } from '../document-presentation/body-cache';
import { useDocumentRetirement } from './retirement.queries';

const rpc = vi.hoisted(() => ({ preview: vi.fn(), retire: vi.fn(), navigate: vi.fn() }));

vi.mock('#web/lib/study-client/request.ts', () => ({
  request: (invoke: (client: Record<string, unknown>) => unknown) =>
    invoke({
      'documents.previewDeletion': rpc.preview,
      'documents.delete': rpc.retire
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
      const document = authoredDocument(10n, 'Private body', 101n);
      const relatedHistory = ['documents', 'history', '10'];
      const sourceCopy = ['source-copy', '7', '8'];
      const unrelated = ['document-editor', '20', '201'];

      cache.setQueryData(relatedHistory, { pages: [{ items: [document.version] }] });
      cache.setQueryData(sourceCopy, { pending: false, document });
      const comparisonKey = ['documents', 'proposal-comparison', 'delete-target'];

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
        documentId: document.id,
        token: 'exact-preview',
        versionIds: [document.version!.id],
        blockedVersionIds: [],
        semantics: 'retire_bodies_retain_identities'
      });

      if (uncertain) rpc.retire.mockRejectedValue(new Error('Lost response'));
      else rpc.retire.mockResolvedValue(undefined);

      const view = renderHook(() => useDocumentRetirement(document), {
        wrapper: ({ children }: { children: ReactNode }) => (
          <QueryClientProvider client={cache}>{children}</QueryClientProvider>
        )
      });

      act(() => view.result.current.open('deletion'));
      await act(async () => {
        await view.result.current.inspect.mutateAsync();
      });
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
      ['documents', 'version', '101'],
      ['documents', 'evidence', '101'],
      ['documents', 'annotationDocument', '10', '101'],
      ['documents', 'retainedRange', '10:101:501:block:0:7'],
      ['documents', 'selected-input', 'document:101'],
      ['search', { query: 'private' }],
      ['session-material-search', 'private']
    ];
    const retained = [
      ['documents', 'version', '102'],
      ['documents', 'annotationDocument', '20', '201'],
      ['sources', 'selected-input', 'source:10:1:101'],
      ['documents', 'annotations', '10'],
      ['document-editor', '20', '201']
    ];

    for (const key of [...retired, ...retained])
      cache.setQueryData(key, 'Body or deliberately retained metadata');

    await releaseBodyPreviews(cache, { kind: 'document', documentId: '10', versionIds: ['101'] });

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
