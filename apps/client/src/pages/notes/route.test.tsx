import { testStable } from '@study/testing/vitest';
import { screen, waitFor } from '@testing-library/react';
import { expect, vi } from 'vite-plus/test';

import { renderPage, pageTestTransport } from '#client/test/render-page.tsx';

vi.mock('./page.view', () => ({
  PageView: ({ id }: { id?: bigint }) => (
    <div data-testid="note-route">{id === undefined ? 'starter' : String(id)}</div>
  )
}));

function renderNoteRoute(path: string) {
  return renderPage(
    path,
    'english',
    pageTestTransport('english', {
      'notes.note': {
        id: 9007199254740993n,
        projectIds: [9007199254740995n],
        title: 'Cell division',
        titleSource: 'user',
        archivedAt: null,
        createdAt: 1n,
        updatedAt: 1n
      }
    })
  );
}

testStable('parses a note path without losing precision and keeps the subject search', async () => {
  const { router } = renderNoteRoute('/notes/9007199254740993?project=9007199254740995');

  expect(await screen.findByTestId('note-route')).toHaveTextContent('9007199254740993');
  const match = router.state.matches.find((item) => item.routeId === '/notes/$noteId');

  expect(match?.params.noteId).toBe(9007199254740993n);
  expect(router.state.location.search.project).toBe('9007199254740995');
  expect(router.state.location.search.id).toBeUndefined();
});

testStable('keeps the starter at the notes index', async () => {
  renderNoteRoute('/notes');
  expect(await screen.findByTestId('note-route')).toHaveTextContent('starter');
});

testStable.each(['0', '-1', '1.5', 'text', '9223372036854775808'])(
  'rejects an invalid note path identity %s',
  async (identity) => {
    const { router } = renderNoteRoute('/notes/' + identity);

    await waitFor(() => expect(router.state.location.pathname).toBe('/notes'));
    expect(await screen.findByTestId('note-route')).toHaveTextContent('starter');
  }
);

testStable('canonicalizes an unscoped note URL to its authoritative subject', async () => {
  const { router } = renderNoteRoute('/notes/9007199254740993');

  expect(await screen.findByTestId('note-route')).toHaveTextContent('9007199254740993');
  await waitFor(() =>
    expect(router.history.location.pathname).toBe(
      '/projects/9007199254740995/notes/9007199254740993'
    )
  );
});

testStable('corrects a foreign subject prefix instead of exposing a mismatched note', async () => {
  const { router } = renderNoteRoute('/projects/2/notes/9007199254740993');

  expect(await screen.findByTestId('note-route')).toHaveTextContent('9007199254740993');
  await waitFor(() =>
    expect(router.history.location.pathname).toBe(
      '/projects/9007199254740995/notes/9007199254740993'
    )
  );
});
