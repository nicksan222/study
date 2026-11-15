import { noteSelectionTargetSchema } from '@study/contracts/notes/context';
import { testStable } from '@study/testing/vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Effect, Schema } from 'effect';
import { afterEach, expect, vi } from 'vite-plus/test';

import { rpcHandlersTransport } from '#client/test/rpc.tsx';
import type { StudyClient } from '#client/test/rpc.tsx';

import { authoredPage } from '../document-editing/test-support';
import { SelectedTarget } from './selection';

vi.mock('#client/lib/i18n.tsx', () => ({ useI18n: () => ({ t: (key: string) => key }) }));

const original = authoredPage(31n, 'Keep selected outside', 41n);

const exact = original.version!;

const target = Schema.decodeUnknownSync(noteSelectionTargetSchema)({
  input: { kind: 'page', versionId: exact.id },
  scope: { kind: 'ranges', ranges: [{ blockId: exact.document.blocks[0]!.id, start: 5, end: 13 }] }
});

function mount(owner = { ...original, title: 'Mechanics' }) {
  const rpc = {
    'pages.version': vi.fn<StudyClient['pages.version']>().mockReturnValue(Effect.succeed(exact)),
    'pages.page': vi.fn<StudyClient['pages.page']>().mockReturnValue(Effect.succeed(owner))
  };

  const fixture = rpcHandlersTransport(rpc);

  render(<SelectedTarget target={target} />, { wrapper: fixture.wrapper });

  return { notify: fixture.notify, rpc };
}

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
testStable(
  'labels the retained authored version and excerpts only its selected range',
  async () => {
    const { rpc } = mount();

    expect(await screen.findByText('Mechanics')).toBeVisible();
    expect(await screen.findByText('selected')).toBeVisible();
    expect(
      screen.getByText(`ReaderVersion ${exact.number} · NoteRanges · NoteSelectionPassageCount`)
    ).toBeVisible();
    expect(rpc['pages.version']).toHaveBeenCalledExactlyOnceWith({ id: exact.id });
    expect(screen.queryByText('Keep selected outside')).toBeNull();
  }
);
testStable('does not display excerpts under a different authored owner identity', async () => {
  mount(authoredPage(32n, 'Different owner', 52n));
  expect(await screen.findByText('NoteReadUnavailable')).toBeVisible();
  expect(screen.queryByText('selected')).toBeNull();
});
testStable(
  'updates the catalog title without replacing retained content with the current authored version',
  async () => {
    const { notify, rpc } = mount({ ...original, title: 'Old catalog title' });

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

testStable('keeps the full selected content behind a native disclosure', async () => {
  const user = userEvent.setup();

  mount();
  expect(await screen.findByText('selected')).toBeVisible();
  const disclosure = screen.getByText('NoteSelectionReadContent');

  await user.click(disclosure);
  expect(disclosure.closest('details')).toHaveAttribute('open');
  expect(screen.getAllByText('selected')).toHaveLength(2);
  expect(screen.queryByText('Keep selected outside')).toBeNull();
});
