import { configureRpcTransport } from '@study/contracts/react';
import { catalogs } from '@study/localization';
import { testStable } from '@study/testing/vitest';
import { render, screen } from '@testing-library/react';
import { expect } from 'vite-plus/test';

import { pageTestTransport } from '#client/test/render-page.tsx';

import { App } from './app';

testStable.each(['/', '/unknown'])('opens the note starter for %s', async (url) => {
  history.replaceState(null, '', url);
  const fixture = pageTestTransport();

  configureRpcTransport(fixture.transport);
  render(<App transport={fixture.transport} />);
  expect(await screen.findByRole('heading', { name: catalogs.english.Notes })).toBeInTheDocument();
});

testStable('opens a lowercase deep link without hash routing', async () => {
  history.replaceState(null, '', '/notes?project=9007199254740993');
  const fixture = pageTestTransport();

  configureRpcTransport(fixture.transport);
  render(<App transport={fixture.transport} />);
  await screen.findByRole('heading', { name: catalogs.english.Notes });
  expect(location.pathname).toBe('/projects/9007199254740993/notes');
  expect(location.search).toBe('');
  expect(location.hash).toBe('');
});
