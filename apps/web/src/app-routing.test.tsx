import { catalogs } from '@study/localization';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vite-plus/test';

import { App } from './app';

const pages = [
  'Home',
  'Sessions',
  'MediaList',
  'Projects',
  'Flashcards',
  'Diagrams',
  'Practice',
  'Pipelines',
  'Settings',
  'Help'
] as const;

beforeEach(() => {
  history.replaceState(null, '', '/');
});

it.each(pages)('renders an empty %s page without calling the server', async (page) => {
  history.replaceState(null, '', `/#/${page}?id=42&project=99`);
  const fetch = vi.spyOn(globalThis, 'fetch');

  render(<App />);
  await screen.findByRole('heading', { name: catalogs.english[page] });
  expect(screen.getByRole('main').textContent).toBe(catalogs.english[page]);
  expect(screen.getByRole('heading', { name: catalogs.english[page] })).toBeInTheDocument();
  expect(fetch).not.toHaveBeenCalled();
});

it('navigates between placeholders and restores browser history', async () => {
  const user = userEvent.setup();

  history.replaceState(null, '', '/#/Home');
  render(<App />);
  await screen.findByRole('heading');
  await user.click(screen.getByRole('link', { name: catalogs.english.Settings }));
  await waitFor(() => expect(location.hash).toBe('#/Settings'));
  expect(
    await screen.findByRole('heading', { name: catalogs.english.Settings })
  ).toBeInTheDocument();
  act(() => history.back());
  expect(await screen.findByRole('heading', { name: catalogs.english.Home })).toBeInTheDocument();
  expect(screen.getByRole('main').textContent).toBe(catalogs.english.Home);
});
