import type { Page } from '@study/contracts/pages/types';
import { testStable } from '@study/testing/vitest';
import { QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, expect, vi } from 'vite-plus/test';

import { createStudyQueryClient } from '#web/lib/query-client.ts';
import { request } from '#web/lib/study-client/request.ts';

import { authoredPage } from '../document-editing/test-support';
import { AuthoredPageReader } from './reader';

vi.mock('#web/lib/study-client/request.ts', () => ({ request: vi.fn() }));
vi.mock('#web/lib/i18n.tsx', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock('#web/lib/study-client/workspace-preferences.queries.ts', () => ({
  useWorkspacePreferences: () => ({ autosaveIntervalSeconds: 3600 })
}));
vi.mock('../note-workspace/canonical-document-editor', () => ({
  CanonicalDocumentEditor: ({
    document,
    disabled,
    toolbarEnd,
    snapshotId
  }: {
    document: { blocks: { text: string }[] };
    disabled?: boolean;
    toolbarEnd: ReactNode;
    snapshotId: bigint;
  }) => (
    <section aria-label="editor" data-snapshot={String(snapshotId)}>
      {toolbarEnd}
      <textarea
        aria-label="content"
        readOnly={disabled}
        value={document.blocks[0]?.text ?? ''}
        onChange={() => undefined}
      />
    </section>
  )
}));
vi.mock('../note-workspace/note-page-metadata', () => ({
  PageMetadata: () => null
}));

const clients: ReturnType<typeof createStudyQueryClient>[] = [];

afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
  vi.clearAllMocks();
});

function mount(initialVersion?: string) {
  const current = authoredPage(2n, 'Current text', 30n);
  const old = authoredPage(2n, 'Old text', 20n).version!;
  let value: Page = current;
  const restore = vi.fn(async () => {
    value = authoredPage(2n, 'Old text', 31n);

    return {
      outcome: 'saved',
      submittedVersionId: 31n,
      currentVersionId: 31n,
      expectedVersionId: 30n,
      replayed: false
    };
  });
  const rpc = {
    'pages.page': vi.fn(async () => value),
    'pages.versions': vi.fn(async () => ({ items: [current.version!, old], nextCursor: null })),
    'pages.version': vi.fn(async ({ id }: { id: bigint }) =>
      id === old.id ? old : current.version!
    ),
    'pages.restore': restore
  };

  vi.mocked(request).mockImplementation((invoke) => invoke(rpc as never) as never);
  const client = createStudyQueryClient();

  clients.push(client);
  const view = render(
    <QueryClientProvider client={client}>
      <AuthoredPageReader id={current.id} initialVersion={initialVersion} />
    </QueryClientProvider>
  );

  return { rpc, current, old, view, client };
}

testStable(
  'version arrows replace content in the same editor and keep old content read-only',
  async () => {
    mount();
    await screen.findByRole('region', { name: 'editor' });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'NotePreviousVersion' })).toBeEnabled()
    );
    fireEvent.click(screen.getByRole('button', { name: 'NotePreviousVersion' }));
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'content' })).toHaveValue('Old text')
    );
    expect(screen.getAllByRole('region', { name: 'editor' })).toHaveLength(1);
    expect(screen.getByRole('textbox', { name: 'content' })).toHaveAttribute('readonly');
    expect(screen.getByRole('region', { name: 'editor' })).toHaveAttribute('data-snapshot', '120');
    expect(screen.getByRole('button', { name: 'NotePreviousVersion' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'NoteNextVersion' }));
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'content' })).toHaveValue('Current text')
    );
    expect(screen.getByRole('textbox', { name: 'content' })).not.toHaveAttribute('readonly');
  }
);

testStable(
  'an old-version deep link uses the editor and can make that content current',
  async () => {
    const { rpc, old } = mount('20');

    await screen.findByDisplayValue('Old text');
    fireEvent.click(screen.getByRole('button', { name: 'PageMakeCurrent' }));
    await waitFor(() => expect(rpc['pages.restore']).toHaveBeenCalledTimes(1));
    expect(rpc['pages.restore'].mock.calls[0]).toEqual([
      {
        pageId: 2n,
        expectedVersionId: 30n,
        restoreVersionId: old.id,
        key: expect.any(String)
      }
    ]);
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'PageMakeCurrent' })).toBeNull()
    );
    expect(screen.getByRole('textbox', { name: 'content' })).toHaveValue('Old text');
    expect(screen.getByRole('textbox', { name: 'content' })).not.toHaveAttribute('readonly');
  }
);

testStable('updates the selected version when the deep link changes in place', async () => {
  const { current, view, client } = mount('20');

  await screen.findByDisplayValue('Old text');
  view.rerender(
    <QueryClientProvider client={client}>
      <AuthoredPageReader id={current.id} initialVersion="30" />
    </QueryClientProvider>
  );
  await screen.findByDisplayValue('Current text');
  expect(screen.getByRole('textbox', { name: 'content' })).not.toHaveAttribute('readonly');
});
