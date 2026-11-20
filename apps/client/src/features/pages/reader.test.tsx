import { pageVersionIdSchema } from '@study/contracts';
import type { Page } from '@study/contracts';
import { test } from '@study/testing';
import type { ReactNode } from 'react';

import type * as __MockType0 from '../document-editing/test-support';
import type * as __MockType1 from './reader';

let authoredPage: typeof __MockType0.authoredPage;

let AuthoredPageReader: typeof __MockType1.AuthoredPageReader;

test.unit.beforeEach(async ({ mock }) => {
  mock('#client/features/pages/improve-document', () => ({ ImproveDocument: () => null }));
  mock('#client/lib/i18n.tsx', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
  mock('#client/lib/study-client/workspace-preferences.queries.ts', () => ({
    useWorkspacePreferences: () => ({ autosaveIntervalSeconds: 3600 })
  }));
  mock('#client/features/note-workspace/canonical-document-editor', () => ({
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
  mock('#client/features/note-workspace/note-page-metadata', () => ({
    PageMetadata: () => null
  }));
  const __mockModule0 = await import('../document-editing/test-support');

  authoredPage = __mockModule0.authoredPage;
  const __mockModule1 = await import('./reader');

  AuthoredPageReader = __mockModule1.AuthoredPageReader;
});

test.unit.afterEach(({ cleanup, vi }) => {
  cleanup();

  vi.clearAllMocks();
});

function mount(
  {
    vi,
    rpcHandlersTransport,
    render
  }: Pick<test.unit.Context, 'vi' | 'rpcHandlersTransport' | 'render'>,
  initialVersion?: string,
  refreshedPage?: Promise<void>
) {
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
    'pages.page': vi.fn(async () => {
      if (value !== current) await refreshedPage;

      return value;
    }),
    'pages.versions': vi.fn(async () => ({
      items: [current.version!, old],
      nextCursor: null
    })),
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

test.unit.stable(
  'version arrows replace content in the same editor and keep old content read-only',
  async ({ screen, waitFor, expect, fireEvent, vi, rpcHandlersTransport, render }) => {
    mount({ vi, rpcHandlersTransport, render });
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

test.unit.stable(
  'an old-version deep link uses the editor and can make that content current',
  async ({ screen, fireEvent, waitFor, expect, vi, rpcHandlersTransport, render }) => {
    const refreshed = Promise.withResolvers<void>();
    const { rpc, old } = mount({ vi, rpcHandlersTransport, render }, '20', refreshed.promise);

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
    refreshed.resolve();
    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: 'content' })).toHaveValue('Old text');
      expect(screen.getByRole('textbox', { name: 'content' })).not.toHaveAttribute('readonly');
    });
  }
);

test.unit.stable(
  'updates the selected version when the deep link changes in place',
  async ({ screen, expect, vi, rpcHandlersTransport, render }) => {
    const { current, view, harness } = mount({ vi, rpcHandlersTransport, render }, '20');

    await screen.findByDisplayValue('Old text');
    view.rerender(
      <harness.wrapper>
        <AuthoredPageReader id={current.id} initialVersion="30" />
      </harness.wrapper>
    );
    await screen.findByDisplayValue('Current text');
    expect(screen.getByRole('textbox', { name: 'content' })).not.toHaveAttribute('readonly');
  }
);
