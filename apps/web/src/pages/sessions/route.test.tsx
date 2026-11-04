import { testStable } from '@study/testing/vitest';
import { screen, waitFor } from '@testing-library/react';
import { expect, vi } from 'vite-plus/test';

import { renderPage } from '#web/test/render-page.tsx';

vi.mock('./page.view', () => ({
  PageView: ({ id }: { id?: bigint }) => (
    <div data-testid="session-route">{id === undefined ? 'starter' : String(id)}</div>
  )
}));

testStable(
  'parses a session path without losing precision and keeps the subject search',
  async () => {
    const { router } = renderPage('/sessions/9007199254740993?project=9007199254740995');

    expect(await screen.findByTestId('session-route')).toHaveTextContent('9007199254740993');
    const match = router.state.matches.find((item) => item.routeId === '/sessions/$sessionId');

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
    const { router } = renderPage('/sessions/' + identity);

    await waitFor(() => expect(router.state.location.pathname).toBe('/home'));
    expect(screen.queryByTestId('session-route')).not.toBeInTheDocument();
  }
);
