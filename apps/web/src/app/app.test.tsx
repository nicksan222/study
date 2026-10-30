import { catalogs } from '@study/localization';
import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vite-plus/test';

import { App } from './app';

vi.mock('../lib/study-client/client', async () => {
  const { Effect } = await import('effect');
  const page = () => Effect.succeed({ items: [], next: null, nextCursor: null });
  const client = {
    'projects.projects': page,
    'conversations.sessions': page,
    'sources.sources': page,
    'materials.materials': page
  };

  return {
    studyClient: Effect.succeed(client)
  };
});

it.each(['/', '/unknown'])('opens Home for %s', async (url) => {
  history.replaceState(null, '', url);
  render(<App />);
  expect(await screen.findByRole('heading', { name: catalogs.english.Home })).toBeInTheDocument();
});

it('opens a lowercase deep link without hash routing', async () => {
  history.replaceState(null, '', '/sessions?project=9007199254740993');
  render(<App />);
  await screen.findByRole('heading', { name: catalogs.english.Sessions });
  expect(location.pathname).toBe('/sessions');
  expect(location.search).toBe('?project=9007199254740993');
  expect(location.hash).toBe('');
});
