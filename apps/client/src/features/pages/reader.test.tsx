import { pageVersionIdSchema } from '@study/contracts';
import type { Page } from '@study/contracts';
import { test } from '@study/testing';
import type { ReactNode } from 'react';

import type * as __MockType0 from '../document-editing/test-support';
import type * as __MockType1 from './reader';

let authoredPage: typeof __MockType0.authoredPage;

let AuthoredPageReader: typeof __MockType1.AuthoredPageReader;

test.beforeEach(async ({ mock }) => {
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

test.afterEach(() => {
  test.cleanup();

  test.vi.clearAllMocks();
});

function mount(initialVersion?: string, refreshedPage?: Promise<void>) {
  const current = authoredPage(2n, 'Current text', 30n);
  const old = authoredPage(2n, 'Old text', 20n).version!;
  let value: Page = current;
  const restore = test.vi.fn(async () => {
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
    'pages.page': test.vi.fn(async () => {
      if (value !== current) await refreshedPage;

      return value;
    }),
    'pages.versions': test.vi.fn(async () => ({
      items: [current.version!, old],
      nextCursor: null
    })),
    'pages.version': test.vi.fn(async ({ id }: { id: bigint }) =>
      id === old.id ? old : current.version!
    ),
    'pages.restore': restore
  };

  const harness = test.rpcHandlersTransport(rpc);

  const view = test.render(
    <harness.wrapper>
      <AuthoredPageReader id={current.id} initialVersion={initialVersion} />
    </harness.wrapper>
  );

  return { rpc, current, old, view, harness };
}

test.stable(
  'version arrows replace content in the same editor and keep old content read-only',
  async () => {
    mount();
    await test.screen.findByRole('region', { name: 'editor' });
    await test.waitFor(() =>
      test.expect(test.screen.getByRole('button', { name: 'NotePreviousVersion' })).toBeEnabled()
    );
    test.fireEvent.click(test.screen.getByRole('button', { name: 'NotePreviousVersion' }));
    await test.waitFor(() =>
      test.expect(test.screen.getByRole('textbox', { name: 'content' })).toHaveValue('Old text')
    );
    test.expect(test.screen.getAllByRole('region', { name: 'editor' })).toHaveLength(1);
    test.expect(test.screen.getByRole('textbox', { name: 'content' })).toHaveAttribute('readonly');
    test
      .expect(test.screen.getByRole('region', { name: 'editor' }))
      .toHaveAttribute('data-snapshot', '120');
    test.expect(test.screen.getByRole('button', { name: 'NotePreviousVersion' })).toBeDisabled();
    const next = test.screen.getByRole('button', { name: 'NoteNextVersion' });

    await test.waitFor(() => test.expect(next).toBeEnabled());
    test.fireEvent.click(next);
    await test.waitFor(() =>
      test.expect(test.screen.getByRole('textbox', { name: 'content' })).toHaveValue('Current text')
    );
    test
      .expect(test.screen.getByRole('textbox', { name: 'content' }))
      .not.toHaveAttribute('readonly');
  }
);

test.stable(
  'an old-version deep link uses the editor and can make that content current',
  async () => {
    const refreshed = Promise.withResolvers<void>();
    const { rpc, old } = mount('20', refreshed.promise);

    await test.screen.findByDisplayValue('Old text');
    test.fireEvent.click(test.screen.getByRole('button', { name: 'PageMakeCurrent' }));
    await test.waitFor(() => test.expect(rpc['pages.restore']).toHaveBeenCalledTimes(1));
    test.expect(rpc['pages.restore'].mock.calls[0]).toEqual([
      {
        pageId: 2n,
        expectedVersionId: pageVersionIdSchema.make(30n),
        restoreVersionId: old.id,
        key: test.expect.any(String)
      }
    ]);
    await test.waitFor(() =>
      test.expect(test.screen.queryByRole('button', { name: 'PageMakeCurrent' })).toBeNull()
    );
    refreshed.resolve();
    await test.waitFor(() => {
      test.expect(test.screen.getByRole('textbox', { name: 'content' })).toHaveValue('Old text');
      test
        .expect(test.screen.getByRole('textbox', { name: 'content' }))
        .not.toHaveAttribute('readonly');
    });
  }
);

test.stable('updates the selected version when the deep link changes in place', async () => {
  const { current, view, harness } = mount('20');

  await test.screen.findByDisplayValue('Old text');
  view.rerender(
    <harness.wrapper>
      <AuthoredPageReader id={current.id} initialVersion="30" />
    </harness.wrapper>
  );
  await test.screen.findByDisplayValue('Current text');
  test
    .expect(test.screen.getByRole('textbox', { name: 'content' }))
    .not.toHaveAttribute('readonly');
});
