import { testStable } from '@study/testing/vitest';
import { screen, waitFor } from '@testing-library/react';
import type { Effect } from 'effect';
import { expect, vi } from 'vite-plus/test';

import { renderPage } from '#web/test/render-page.tsx';

vi.mock('#web/lib/study-client/request.ts', async () => {
  const { Effect } = await import('effect');
  const page = () => Effect.succeed({ items: [], next: null, nextCursor: null });

  return {
    request: (invoke: (client: Record<string, unknown>) => Effect.Effect<unknown, unknown>) =>
      Effect.runPromise(
        invoke({
          'projects.projects': page,
          'conversations.sessions': page,
          'conversations.session': ({ id }: { id: bigint }) =>
            Effect.succeed({
              id,
              projectIds: [9007199254740995n],
              title: 'Cell division',
              titleSource: 'user',
              createdAt: 1n,
              updatedAt: 1n
            })
        })
      )
  };
});

vi.mock('./page.view', () => ({
  PageView: ({ id }: { id?: bigint }) => (
    <div data-testid="session-route">{id === undefined ? 'starter' : String(id)}</div>
  )
}));

testStable(
  'parses a session path without losing precision and keeps the subject search',
  async () => {
    const { router } = renderPage('/session/9007199254740993?project=9007199254740995');

    expect(await screen.findByTestId('session-route')).toHaveTextContent('9007199254740993');
    const match = router.state.matches.find((item) => item.routeId === '/session/$sessionId');

    expect(match?.params.sessionId).toBe(9007199254740993n);
    expect(router.state.location.search.project).toBe('9007199254740995');
    expect(router.state.location.search.id).toBeUndefined();
  }
);

testStable('keeps the starter at the sessions index', async () => {
  renderPage('/sessions');
  expect(await screen.findByTestId('session-route')).toHaveTextContent('starter');
});

testStable.each(['0', '-1', '1.5', 'text', '9223372036854775808'])(
  'rejects an invalid session path identity %s',
  async (identity) => {
    const { router } = renderPage('/session/' + identity);

    await waitFor(() => expect(router.state.location.pathname).toBe('/sessions'));
    expect(await screen.findByTestId('session-route')).toHaveTextContent('starter');
  }
);

testStable('canonicalizes an unscoped session URL to its authoritative subject', async () => {
  const { router } = renderPage('/session/9007199254740993');

  expect(await screen.findByTestId('session-route')).toHaveTextContent('9007199254740993');
  await waitFor(() =>
    expect(router.history.location.pathname).toBe(
      '/projects/9007199254740995/session/9007199254740993'
    )
  );
});

testStable(
  'corrects a foreign subject prefix instead of exposing a mismatched session',
  async () => {
    const { router } = renderPage('/projects/2/session/9007199254740993');

    expect(await screen.findByTestId('session-route')).toHaveTextContent('9007199254740993');
    await waitFor(() =>
      expect(router.history.location.pathname).toBe(
        '/projects/9007199254740995/session/9007199254740993'
      )
    );
  }
);

testStable('does not keep the retired session URL registered', async () => {
  const { router } = renderPage('/sessions/9007199254740993');

  expect(await screen.findByTestId('session-route')).toHaveTextContent('starter');
  expect(
    router.state.matches.some((match) => String(match.routeId) === '/sessions/$sessionId')
  ).toBe(false);
});
