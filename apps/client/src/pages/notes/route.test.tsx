import { noteIdSchema, projectIdSchema } from '@study/contracts';
import { test } from '@study/testing';

test.unit.beforeEach(async ({ mock }) => {
  mock('#client/pages/notes/page.view.tsx', () => ({
    PageView: ({ id }: { id?: bigint }) => (
      <div data-testid="note-route">{id === undefined ? 'starter' : String(id)}</div>
    )
  }));
});

test.unit.beforeEach(({ rpc }) => {
  rpc.given({
    'notes.note': {
      id: noteIdSchema.make(9007199254740993n),
      projectIds: [projectIdSchema.make(9007199254740995n)],
      title: 'Cell division',
      titleSource: 'user',
      archivedAt: null,
      createdAt: 1n,
      updatedAt: 1n
    }
  });
});

test.unit.stable(
  'parses a note path without losing precision and keeps the subject search',
  async ({ page, expect, screen }) => {
    const { router } = await page.open('/notes/9007199254740993?project=9007199254740995');

    expect(await screen.findByTestId('note-route')).toHaveTextContent('9007199254740993');
    const match = router.state.matches.find((item) => item.routeId === '/notes/$noteId');

    expect(match?.params.noteId).toBe(9007199254740993n);
    expect(router.state.location.search.project).toBe('9007199254740995');
    expect(router.state.location.search.id).toBeUndefined();
  }
);

test.unit.stable('keeps the starter at the notes index', async ({ page, expect, screen }) => {
  await page.open('/notes');
  expect(await screen.findByTestId('note-route')).toHaveTextContent('starter');
});

test.unit.stable.for(['0', '-1', '1.5', 'text', '9223372036854775808'])(
  'rejects an invalid note path identity %s',
  async (identity, { page, waitFor, expect, screen }) => {
    const { router } = await page.open('/notes/' + identity);

    await waitFor(() => expect(router.state.location.pathname).toBe('/notes'));
    expect(await screen.findByTestId('note-route')).toHaveTextContent('starter');
  }
);

test.unit.stable(
  'canonicalizes an unscoped note URL to its authoritative subject',
  async ({ page, expect, screen, waitFor }) => {
    const { router } = await page.open('/notes/9007199254740993');

    expect(await screen.findByTestId('note-route')).toHaveTextContent('9007199254740993');
    await waitFor(() =>
      expect(router.history.location.pathname).toBe(
        '/projects/9007199254740995/notes/9007199254740993'
      )
    );
  }
);

test.unit.stable(
  'corrects a foreign subject prefix instead of exposing a mismatched note',
  async ({ page, expect, screen, waitFor }) => {
    const { router } = await page.open('/projects/2/notes/9007199254740993');

    expect(await screen.findByTestId('note-route')).toHaveTextContent('9007199254740993');
    await waitFor(() =>
      expect(router.history.location.pathname).toBe(
        '/projects/9007199254740995/notes/9007199254740993'
      )
    );
  }
);
