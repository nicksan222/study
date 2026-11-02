import { StudyError } from '@study/contracts/errors';
import {
  documentComparisonSchema,
  documentProposalOutcomeSchema
} from '@study/contracts/materials/editing';
import { materialVersionDetailSchema } from '@study/contracts/materials/schemas';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type * as MockModule0 from '@tanstack/react-router';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Schema } from 'effect';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vite-plus/test';

import { ProposalReview } from './proposal-review';

const rpc = vi.hoisted(() => ({
  compare: vi.fn(),
  apply: vi.fn(),
  keep: vi.fn(),
  version: vi.fn()
}));

vi.mock('../../lib/i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock('../../lib/study-client/request', () => ({
  request: (fn: (client: unknown) => unknown) =>
    fn({
      'materials.compareDocumentProposal': rpc.compare,
      'materials.applyDocumentProposal': rpc.apply,
      'materials.keepDocumentProposal': rpc.keep
    })
}));
vi.mock('../../lib/study-client/materials.queries', () => ({
  versionOptions: (id: unknown) => ({
    queryKey: ['materials', 'version', String(id)],
    queryFn: () => rpc.version(id)
  })
}));
vi.mock('./document-actions', () => ({ ComparisonView: () => <p>Structural comparison</p> }));
vi.mock('@tanstack/react-router', async (load) => ({
  ...(await load<typeof MockModule0>()),
  Link: ({ children }: { children: ReactNode }) => <span>{children}</span>
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });

  return { promise, resolve };
}

const version = (id: bigint) =>
  Schema.decodeUnknownSync(materialVersionDetailSchema)({
    id,
    material_id: 41n,
    number: 1n,
    operation: 'original',
    creator: 'import',
    instruction: null,
    language: null,
    created_at: 1n,
    published_at: 1n,
    status: 'published',
    inputs: [],
    parents: [],
    kind: 'document',
    content: {
      kind: 'document',
      blocks: [],
      meta: {
        extractor: null,
        extractorVersion: 1,
        provider: null,
        durationMs: null,
        pageCount: null,
        refiners: [],
        waitingFor: [],
        corrected: false,
        omissions: []
      }
    }
  });

const comparison = (current = 101n, base = 100n) =>
  Schema.decodeUnknownSync(documentComparisonSchema)({
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
  Schema.decodeUnknownSync(documentProposalOutcomeSchema)({
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

it.each(['apply', 'keep'] as const)(
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

    if (kind === 'apply')
      expect(submitted).toMatchObject({ expectedVersionId: 101n, baseVersionId: 100n });

    rpc.compare.mockResolvedValue(comparison(201n, 200n));
    await act(async () => {
      await first.client.invalidateQueries({ queryKey: ['materials', 'proposal-comparison'] });
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

it('excludes duplicate mounts synchronously and retains a late receipt before invalidation finishes', async () => {
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
});

it('requires deliberate Keep after conflict and gives it a distinct operation key', async () => {
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
  expect(rpc.keep.mock.calls[0]![0]).toEqual({ requestId: 'proposal-1', key: expect.any(String) });
  expect(rpc.keep.mock.calls[0]![0].key).not.toBe(rpc.apply.mock.calls[0]![0].key);
  expect(screen.getByRole('button', { name: 'DocumentKeepNew' })).toBeDisabled();
});
