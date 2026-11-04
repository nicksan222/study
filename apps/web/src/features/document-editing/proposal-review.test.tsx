import { comparisonSchema, proposalOutcomeSchema } from '@study/contracts/documents/editing';
import { StudyError } from '@study/contracts/errors';
import { testStable } from '@study/testing/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type * as MockModule0 from '@tanstack/react-router';
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor
} from '@testing-library/react';
import { Schema } from 'effect';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, expect, vi } from 'vite-plus/test';

import { useDocumentRetirement } from '../authored-documents/retirement.queries';
import { releaseBodyPreviews } from '../document-presentation/body-cache';
import { ProposalReview } from './proposal-review';
import { authoredDocument } from './test-support';

const rpc = vi.hoisted(() => ({
  compare: vi.fn(),
  apply: vi.fn(),
  keep: vi.fn(),
  version: vi.fn(),
  preview: vi.fn(),
  retire: vi.fn(),
  navigate: vi.fn()
}));

vi.mock('#web/lib/i18n.tsx', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock('#web/lib/study-client/request.ts', () => ({
  request: (fn: (client: unknown) => unknown) =>
    fn({
      'documents.compareProposal': rpc.compare,
      'documents.applyProposal': rpc.apply,
      'documents.keepProposal': rpc.keep,
      'documents.previewDeletion': rpc.preview,
      'documents.delete': rpc.retire
    })
}));
vi.mock('#web/lib/study-client/documents.queries.ts', () => ({
  documentVersionOptions: (id: unknown) => ({
    queryKey: ['documents', 'version', String(id)],
    queryFn: () => rpc.version(id)
  })
}));
vi.mock('@tanstack/react-router', async (load) => ({
  ...(await load<typeof MockModule0>()),
  useNavigate: () => rpc.navigate,
  Link: ({ children }: { children: ReactNode }) => <span>{children}</span>
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((accept, fail) => {
    resolve = accept;
    reject = fail;
  });

  return { promise, resolve, reject };
}

const version = (id: bigint) => authoredDocument(41n, `Proposal private body ${id}`, id).version!;

const comparison = (current = 101n, base = 100n) =>
  Schema.decodeUnknownSync(comparisonSchema)({
    beforeVersionId: base,
    proposedVersionId: 102n,
    currentVersionId: current,
    before: version(base),
    proposed: version(102n),
    current: version(current),
    proposedChanges: [],
    currentChanges: [],
    evidence: 'structural_only'
  });

const receipt = (outcome = 'applied') =>
  Schema.decodeUnknownSync(proposalOutcomeSchema)({
    requestId: 'proposal-1',
    outcome,
    baseVersionId: 100n,
    proposedVersionId: 102n,
    currentVersionId: 101n,
    resultVersionId: outcome === 'conflict' ? null : 103n,
    replayed: false
  });

const clients: QueryClient[] = [];

function mount(
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } }),
  copies = 1
) {
  if (!clients.includes(client)) clients.push(client);

  return {
    client,
    ...render(
      <QueryClientProvider client={client}>
        {Array.from({ length: copies }, (_, index) => (
          <ProposalReview key={index} requestId="proposal-1" />
        ))}
      </QueryClientProvider>
    )
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  rpc.compare.mockResolvedValue(comparison());
  rpc.version.mockImplementation((id) => version(id));
});
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
});

testStable.each(['apply', 'keep'] as const)(
  'retries the exact %s payload after comparison refresh and remount',
  async (kind) => {
    const operation = rpc[kind];

    operation
      .mockRejectedValueOnce(new StudyError('transient', 'Receipt lost'))
      .mockResolvedValueOnce(receipt(kind === 'apply' ? 'applied' : 'kept'));
    const first = mount();

    fireEvent.click(
      await screen.findByRole('button', {
        name: kind === 'apply' ? 'DocumentApply' : 'DocumentKeepNew'
      })
    );
    await screen.findByRole('alert');
    const submitted = operation.mock.calls[0]![0];

    expect(submitted).toMatchObject({ requestId: 'proposal-1', key: expect.any(String) });
    if (kind === 'keep') expect(submitted).toMatchObject({ title: 'DocumentCopyTitle' });

    if (kind === 'apply') expect(submitted).toMatchObject({ expectedVersionId: 100n });

    rpc.compare.mockResolvedValue(comparison(201n, 200n));
    await act(async () => {
      await first.client.invalidateQueries({ queryKey: ['documents', 'proposal-comparison'] });
    });
    first.unmount();
    mount(first.client);
    expect(operation).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'DocumentApply' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'DocumentKeepNew' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'DocumentRetryProposal' }));
    await screen.findByText('DocumentProposalSaved');
    expect(operation).toHaveBeenCalledTimes(2);
    expect(operation.mock.calls[1]![0]).toEqual(submitted);
    expect(rpc.version).toHaveBeenCalledWith(103n);
    expect(rpc.version).not.toHaveBeenCalledWith(102n);
  }
);

testStable(
  'excludes duplicate mounts synchronously and retains a late receipt before invalidation finishes',
  async () => {
    const response = deferred<ReturnType<typeof receipt>>();

    rpc.apply.mockReturnValue(response.promise);
    const first = mount(undefined, 2);

    await screen.findAllByRole('button', { name: 'DocumentApply' });
    const buttons = screen.getAllByRole('button', { name: 'DocumentApply' });

    act(() => {
      fireEvent.click(buttons[0]!);
      fireEvent.click(buttons[1]!);
    });
    await waitFor(() => expect(rpc.apply).toHaveBeenCalledTimes(1));
    first.unmount();
    const refresh = deferred<void>();
    const invalidate = vi.spyOn(first.client, 'invalidateQueries').mockReturnValue(refresh.promise);

    await act(async () => {
      response.resolve(receipt());
      await response.promise;
    });
    const reopened = mount(first.client);

    await screen.findByText('DocumentProposalSaved');
    expect(rpc.version).toHaveBeenCalledWith(103n);
    expect(screen.getByRole('button', { name: 'DocumentKeepNew' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'DocumentRetryProposal' })).toBeNull();
    await act(async () => {
      refresh.resolve(undefined);
      await refresh.promise;
    });
    invalidate.mockRestore();
    reopened.unmount();
    mount(first.client);
    await screen.findByText('DocumentProposalSaved');
    expect(screen.getByRole('button', { name: 'DocumentApply' })).toBeDisabled();
    expect(rpc.apply).toHaveBeenCalledTimes(1);
    expect(rpc.keep).not.toHaveBeenCalled();
  }
);

testStable(
  'requires deliberate Keep after conflict and gives it a distinct operation key',
  async () => {
    rpc.apply.mockResolvedValue(receipt('conflict'));
    rpc.keep.mockResolvedValue(receipt('kept'));
    const first = mount();

    fireEvent.click(await screen.findByRole('button', { name: 'DocumentApply' }));
    await screen.findByText('DocumentConflict');
    expect(rpc.keep).not.toHaveBeenCalled();
    first.unmount();
    mount(first.client);
    expect(screen.getByRole('button', { name: 'DocumentApply' })).toBeDisabled();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'DocumentKeepNew' })).toBeEnabled()
    );
    fireEvent.click(screen.getByRole('button', { name: 'DocumentKeepNew' }));
    await screen.findByText('DocumentProposalSaved');
    expect(rpc.keep).toHaveBeenCalledTimes(1);
    expect(rpc.keep.mock.calls[0]![0]).toEqual({
      requestId: 'proposal-1',
      key: expect.any(String),
      title: 'DocumentCopyTitle'
    });
    expect(rpc.keep.mock.calls[0]![0].key).not.toBe(rpc.apply.mock.calls[0]![0].key);
    expect(screen.getByRole('button', { name: 'DocumentKeepNew' })).toBeDisabled();
  }
);

testStable(
  'hides cached comparison bodies and apply/keep actions when mounted availability fails',
  async () => {
    const view = mount();
    await screen.findByRole('button', { name: 'DocumentApply' });
    fireEvent.click(screen.getByText('DocumentSubmitted', { selector: 'summary' }));
    expect(screen.getByText('Proposal private body 102')).toBeVisible();
    rpc.compare.mockRejectedValue(new StudyError('not_found', 'Document deleted'));
    await act(async () => {
      await view.client.invalidateQueries({ queryKey: ['documents', 'proposal-comparison'] });
    });
    await screen.findByRole('alert');
    expect(
      view.client.getQueryState(['documents', 'proposal-comparison', 'proposal-1'])?.status
    ).toBe('error');
    expect(screen.queryByText('Proposal private body 102')).toBeNull();
    expect(screen.queryByRole('button', { name: 'DocumentApply' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'DocumentKeepNew' })).toBeNull();
    expect(rpc.apply).not.toHaveBeenCalled();
    expect(rpc.keep).not.toHaveBeenCalled();
  }
);

testStable.each(['before', 'proposed', 'current'] as const)(
  'releases inactive comparisons by actual %s owner/version and preserves other bodies and drafts',
  async (slot) => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } }
    });
    clients.push(client);
    const value = comparison();
    const key = ['documents', 'proposal-comparison', 'proposal-1'];
    const otherOwner = {
      ...value,
      [slot]: authoredDocument(42n, 'Unrelated owner', 501n).version!
    };
    // Only this slot carries the selected retirement identity; other fields must not be inferred from requestId or top-level IDs.
    const target = { ...value, [slot]: authoredDocument(77n, 'Retired exact body', 501n).version! };
    const otherVersion = {
      ...target,
      [slot]: authoredDocument(77n, 'Retained same owner', 502n).version!
    };
    client.setQueryData(key, target);
    client.setQueryData(['documents', 'proposal-comparison', 'other-owner'], otherOwner);
    client.setQueryData(['documents', 'proposal-comparison', 'other-version'], otherVersion);
    const draftKey = ['document-editor', '77', '502'];
    const noteKey = ['documents', 'annotations', '77'];
    client.setQueryData(draftKey, { text: 'Unsaved retained draft' });
    client.setQueryData(noteKey, { note: 'Retained annotation note' });
    await releaseBodyPreviews(client, { kind: 'document', documentId: '77', versionIds: ['501'] });
    expect(client.getQueryData(key)).toBeUndefined();
    expect(client.getQueryData(['documents', 'proposal-comparison', 'other-owner'])).toBe(
      otherOwner
    );
    expect(client.getQueryData(['documents', 'proposal-comparison', 'other-version'])).toBe(
      otherVersion
    );
    expect(client.getQueryData(draftKey)).toEqual({ text: 'Unsaved retained draft' });
    expect(client.getQueryData(noteKey)).toEqual({ note: 'Retained annotation note' });
    rpc.compare.mockRejectedValue(new StudyError('not_found', 'Version retired'));
    mount(client);
    await screen.findByRole('alert');
    expect(screen.queryByText('Retired exact body')).toBeNull();
    expect(screen.queryByRole('button', { name: 'DocumentApply' })).toBeNull();
  }
);

testStable.each([false, true])(
  'releases proposal bodies through confirmed deletion and prevents reentry (mounted: %s)',
  async (mounted) => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } }
    });
    clients.push(client);
    const key = ['documents', 'proposal-comparison', 'proposal-1'];
    client.setQueryData(key, comparison());
    const first = mounted ? mount(client) : undefined;
    if (first) {
      fireEvent.click(await screen.findByText('DocumentSubmitted', { selector: 'summary' }));
      expect(screen.getByText('Proposal private body 102')).toBeVisible();
    }
    rpc.preview.mockResolvedValue({
      documentId: version(100n).documentId,
      token: 'delete-exact',
      versionIds: [100n, 101n, 102n],
      blockedVersionIds: [],
      semantics: 'retire_bodies_retain_identities'
    });
    rpc.retire.mockImplementation(async () => {
      rpc.compare.mockRejectedValue(new StudyError('not_found', 'Document deleted'));
    });
    const retirement = renderHook(() => useDocumentRetirement(authoredDocument(41n, '', 101n)), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      )
    });
    act(() => retirement.result.current.open('deletion'));
    await act(async () => {
      await retirement.result.current.inspect.mutateAsync();
    });
    await act(async () => {
      await retirement.result.current.retire.mutateAsync();
    });
    expect(rpc.retire).toHaveBeenCalledExactlyOnceWith({
      documentId: version(100n).documentId,
      token: 'delete-exact'
    });
    expect(client.getQueryData(key)).toBeUndefined();
    // Query cache updates precede batched React subscriber notifications.
    if (mounted) await screen.findByRole('alert');
    expect(screen.queryByText('Proposal private body 100')).toBeNull();
    expect(screen.queryByText('Proposal private body 101')).toBeNull();
    expect(screen.queryByText('Proposal private body 102')).toBeNull();
    expect(screen.queryByRole('button', { name: 'DocumentApply' })).toBeNull();
    first?.unmount();
    retirement.unmount();
    mount(client);
    await screen.findByRole('alert');
    expect(screen.queryByText('Proposal private body 102')).toBeNull();
    expect(screen.queryByRole('button', { name: 'DocumentKeepNew' })).toBeNull();
  }
);

testStable(
  'clears a mounted comparison while retirement availability is still pending',
  async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } }
    });
    const key = ['documents', 'proposal-comparison', 'proposal-1'];
    client.setQueryData(key, comparison());
    mount(client);
    fireEvent.click(screen.getByText('DocumentSubmitted', { selector: 'summary' }));
    expect(screen.getByText('Proposal private body 102')).toBeVisible();
    const availability = deferred<ReturnType<typeof comparison>>();
    rpc.compare.mockReturnValue(availability.promise);
    const release = releaseBodyPreviews(client, {
      kind: 'document',
      documentId: '41',
      versionIds: ['102']
    });
    await waitFor(() => {
      expect(client.getQueryState(key)?.fetchStatus).toBe('fetching');
      expect(screen.queryByText('Proposal private body 102')).toBeNull();
      expect(screen.queryByRole('button', { name: 'DocumentApply' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'DocumentKeepNew' })).toBeNull();
    });
    await act(async () => {
      availability.reject(new StudyError('not_found', 'Version retired'));
      await release;
    });
    await screen.findByRole('alert');
    expect(screen.queryByText('Proposal private body 102')).toBeNull();
    expect(screen.queryByRole('button', { name: 'DocumentApply' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'DocumentKeepNew' })).toBeNull();
  }
);
