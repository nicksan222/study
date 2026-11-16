import { noteSelectionTargetSchema } from '@study/contracts';
import type { StudyClient } from '@study/contracts/react/testing';
import { test } from '@study/testing';
import { Effect, Schema } from 'effect';

import type * as __MockType0 from '../document-editing/test-support';
import type * as __MockType1 from './selection';

let authoredPage: typeof __MockType0.authoredPage;

let SelectedTarget: typeof __MockType1.SelectedTarget;

function initializeOriginal() {
  return authoredPage(31n, 'Keep selected outside', 41n);
}

let original: ReturnType<typeof initializeOriginal>;

function initializeExact() {
  return original.version!;
}

let exact: ReturnType<typeof initializeExact>;

function initializeTarget() {
  return Schema.decodeUnknownSync(noteSelectionTargetSchema)({
    input: { kind: 'page', versionId: exact.id },
    scope: {
      kind: 'ranges',
      ranges: [{ blockId: exact.document.blocks[0]!.id, start: 5, end: 13 }]
    }
  });
}

let target: ReturnType<typeof initializeTarget>;

function mount(
  {
    vi,
    rpcHandlersTransport,
    render
  }: Pick<test.Context, 'vi' | 'rpcHandlersTransport' | 'render'>,
  owner = { ...original, title: 'Mechanics' }
) {
  const rpc = {
    'pages.version': vi.fn<StudyClient['pages.version']>().mockReturnValue(Effect.succeed(exact)),
    'pages.page': vi.fn<StudyClient['pages.page']>().mockReturnValue(Effect.succeed(owner))
  };

  const fixture = rpcHandlersTransport(rpc);

  render(<SelectedTarget target={target} />, { wrapper: fixture.wrapper });

  return { notify: fixture.notify, rpc };
}

test.beforeEach(async ({ mock }) => {
  mock('#client/lib/i18n.tsx', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
  const __mockModule0 = await import('../document-editing/test-support');

  authoredPage = __mockModule0.authoredPage;
  const __mockModule1 = await import('./selection');

  SelectedTarget = __mockModule1.SelectedTarget;
  original = initializeOriginal();
  exact = initializeExact();
  target = initializeTarget();
});

test.afterEach(({ cleanup, vi }) => {
  cleanup();
  vi.resetAllMocks();
});
test.stable(
  'labels the retained authored version and excerpts only its selected range',
  async ({ expect, screen, vi, rpcHandlersTransport, render }) => {
    const { rpc } = mount({ vi, rpcHandlersTransport, render });

    expect(await screen.findByText('Mechanics')).toBeVisible();
    expect(await screen.findByText('selected')).toBeVisible();
    expect(
      screen.getByText(`ReaderVersion ${exact.number} · NoteRanges · NoteSelectionPassageCount`)
    ).toBeVisible();
    expect(rpc['pages.version']).toHaveBeenCalledExactlyOnceWith({ id: exact.id });
    expect(screen.queryByText('Keep selected outside')).toBeNull();
  }
);
test.stable(
  'does not display excerpts under a different authored owner identity',
  async ({ expect, screen, vi, rpcHandlersTransport, render }) => {
    mount({ vi, rpcHandlersTransport, render }, authoredPage(32n, 'Different owner', 52n));
    expect(await screen.findByText('NoteReadUnavailable')).toBeVisible();
    expect(screen.queryByText('selected')).toBeNull();
  }
);
test.stable(
  'updates the catalog title without replacing retained content with the current authored version',
  async ({ expect, screen, act, vi, rpcHandlersTransport, render }) => {
    const { notify, rpc } = mount(
      { vi, rpcHandlersTransport, render },
      { ...original, title: 'Old catalog title' }
    );

    expect(await screen.findByText('selected')).toBeVisible();
    expect(await screen.findByText('Old catalog title')).toBeVisible();
    rpc['pages.page'].mockReturnValue(
      Effect.succeed({
        ...authoredPage(31n, 'Latest replacement content', 99n),
        title: 'Renamed catalog title'
      })
    );
    await act(async () => {
      await notify();
    });
    expect(await screen.findByText('Renamed catalog title')).toBeVisible();
    expect(screen.getByText('selected')).toBeVisible();
    expect(screen.queryByText('Latest replacement content')).toBeNull();
    expect(rpc['pages.version'].mock.calls.every(([input]) => input.id === exact.id)).toBe(true);
  }
);

test.stable(
  'keeps the full selected content behind a native disclosure',
  async ({ userEvent, expect, screen, vi, rpcHandlersTransport, render }) => {
    const user = userEvent.setup();

    mount({ vi, rpcHandlersTransport, render });
    expect(await screen.findByText('selected')).toBeVisible();
    const disclosure = screen.getByText('NoteSelectionReadContent');

    await user.click(disclosure);
    expect(disclosure.closest('details')).toHaveAttribute('open');
    expect(screen.getAllByText('selected')).toHaveLength(2);
    expect(screen.queryByText('Keep selected outside')).toBeNull();
  }
);
