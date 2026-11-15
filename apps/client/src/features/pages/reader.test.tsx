import { pageVersionIdSchema } from '@study/contracts/ids';
import type { Page } from '@study/contracts/pages/types';
import { testStable } from '@study/testing/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, expect, vi } from 'vite-plus/test';

import { rpcHandlersTransport } from '#client/test/rpc.tsx';

import { authoredPage } from '../document-editing/test-support';
import { AuthoredPageReader } from './reader';

vi.mock('#client/lib/i18n.tsx', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock('#client/lib/study-client/workspace-preferences.queries.ts', () => ({
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

afterEach(() => {
  cleanup();

  vi.clearAllMocks();
});

function mount(initialVersion?: string) {
  const current = authoredPage(2n, 'Current text', 30n);
  const old = authoredPage(2n, 'Old text', 20n).version!;
  let value: Page = current;
  const restore = vi.fn(async () => {
    value = authoredPage(2n, 'Old text', 31n);

    return {
      outcome: 'saved' as const,
      submittedVersionId: pageVersionIdSchema.make(31n),
      currentVersionId: pageVersionIdSchema.make(31n),
      expectedVersionId: pageVersionIdSchema.make(30n),
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

  const harness = rpcHandlersTransport(rpc);

  const view = render(
    <harness.wrapper>
      <AuthoredPageReader id={current.id} initialVersion={initialVersion} />
    </harness.wrapper>
  );

  return { rpc, current, old, view, harness };
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
    const next = screen.getByRole('button', { name: 'NoteNextVersion' });

    await waitFor(() => expect(next).toBeEnabled());
    fireEvent.click(next);
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
        expectedVersionId: pageVersionIdSchema.make(30n),
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
  const { current, view, harness } = mount('20');

  await screen.findByDisplayValue('Old text');
  view.rerender(
    <harness.wrapper>
      <AuthoredPageReader id={current.id} initialVersion="30" />
    </harness.wrapper>
  );
  await screen.findByDisplayValue('Current text');
  expect(screen.getByRole('textbox', { name: 'content' })).not.toHaveAttribute('readonly');
});
