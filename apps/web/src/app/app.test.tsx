import { catalogs } from '@study/localization';
import { testStable } from '@study/testing/vitest';
import { render, screen } from '@testing-library/react';
import { expect, vi } from 'vite-plus/test';

import { App } from './app';

vi.mock('../lib/study-client/client', async () => {
  const { Effect } = await import('effect');
  const page = () => Effect.succeed({ items: [], next: null, nextCursor: null });
  const client = {
    'system.health': () =>
      Effect.succeed({ protocolVersion: 1, workersRunning: true, testMode: false }),
    'projects.projects': page,
    'notes.notes': page,
    'sources.sources': page,
    'materials.materials': page
  };

  return {
    studyClient: Effect.succeed(client)
  };
});

testStable.each(['/', '/unknown'])('opens the note starter for %s', async (url) => {
  history.replaceState(null, '', url);
  render(<App />);
  expect(await screen.findByRole('heading', { name: catalogs.english.Notes })).toBeInTheDocument();
});

testStable('opens a lowercase deep link without hash routing', async () => {
  history.replaceState(null, '', '/notes?project=9007199254740993');
  render(<App />);
  await screen.findByRole('heading', { name: catalogs.english.Notes });
  expect(location.pathname).toBe('/projects/9007199254740993/notes');
  expect(location.search).toBe('');
  expect(location.hash).toBe('');
});
