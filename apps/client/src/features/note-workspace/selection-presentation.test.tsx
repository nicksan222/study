import { noteSelectionTargetSchema } from '@study/contracts';
import type { StudyClient } from '@study/contracts/react/testing';
import { test } from '@study/testing';
import { Effect, Schema } from 'effect';

import { authoredPage } from '../document-editing/test-support';
import { SelectedTarget } from './selection';

test.mock('#client/lib/i18n.tsx', () => ({ useI18n: () => ({ t: (key: string) => key }) }));

const original = authoredPage(31n, 'Keep selected outside', 41n);

const exact = original.version!;

const target = Schema.decodeUnknownSync(noteSelectionTargetSchema)({
  input: { kind: 'page', versionId: exact.id },
  scope: { kind: 'ranges', ranges: [{ blockId: exact.document.blocks[0]!.id, start: 5, end: 13 }] }
});

function mount(owner = { ...original, title: 'Mechanics' }) {
  const rpc = {
    'pages.version': test.vi
      .fn<StudyClient['pages.version']>()
      .mockReturnValue(Effect.succeed(exact)),
    'pages.page': test.vi.fn<StudyClient['pages.page']>().mockReturnValue(Effect.succeed(owner))
  };

  const fixture = test.rpcHandlersTransport(rpc);

  test.render(<SelectedTarget target={target} />, { wrapper: fixture.wrapper });

  return { notify: fixture.notify, rpc };
}

test.afterEach(() => {
  test.cleanup();
  test.vi.resetAllMocks();
});
test.stable(
  'labels the retained authored version and excerpts only its selected range',
  async () => {
    const { rpc } = mount();

    test.expect(await test.screen.findByText('Mechanics')).toBeVisible();
    test.expect(await test.screen.findByText('selected')).toBeVisible();
    test
      .expect(
        test.screen.getByText(
          `ReaderVersion ${exact.number} · NoteRanges · NoteSelectionPassageCount`
        )
      )
      .toBeVisible();
    test.expect(rpc['pages.version']).toHaveBeenCalledExactlyOnceWith({ id: exact.id });
    test.expect(test.screen.queryByText('Keep selected outside')).toBeNull();
  }
);
test.stable('does not display excerpts under a different authored owner identity', async () => {
  mount(authoredPage(32n, 'Different owner', 52n));
  test.expect(await test.screen.findByText('NoteReadUnavailable')).toBeVisible();
  test.expect(test.screen.queryByText('selected')).toBeNull();
});
test.stable(
  'updates the catalog title without replacing retained content with the current authored version',
  async () => {
    const { notify, rpc } = mount({ ...original, title: 'Old catalog title' });

    test.expect(await test.screen.findByText('selected')).toBeVisible();
    test.expect(await test.screen.findByText('Old catalog title')).toBeVisible();
    rpc['pages.page'].mockReturnValue(
      Effect.succeed({
        ...authoredPage(31n, 'Latest replacement content', 99n),
        title: 'Renamed catalog title'
      })
    );
    await test.act(async () => {
      await notify();
    });
    test.expect(await test.screen.findByText('Renamed catalog title')).toBeVisible();
    test.expect(test.screen.getByText('selected')).toBeVisible();
    test.expect(test.screen.queryByText('Latest replacement content')).toBeNull();
    test
      .expect(rpc['pages.version'].mock.calls.every(([input]) => input.id === exact.id))
      .toBe(true);
  }
);

test.stable('keeps the full selected content behind a native disclosure', async () => {
  const user = test.userEvent.setup();

  mount();
  test.expect(await test.screen.findByText('selected')).toBeVisible();
  const disclosure = test.screen.getByText('NoteSelectionReadContent');

  await user.click(disclosure);
  test.expect(disclosure.closest('details')).toHaveAttribute('open');
  test.expect(test.screen.getAllByText('selected')).toHaveLength(2);
  test.expect(test.screen.queryByText('Keep selected outside')).toBeNull();
});
