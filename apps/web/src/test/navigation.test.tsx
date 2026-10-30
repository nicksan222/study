import { catalogs } from '@study/localization';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vite-plus/test';

import { App } from '../app/app';

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
  history.replaceState(
    null,
    '',
    `/${page === 'MediaList' ? 'media-list' : page.toLowerCase()}?id=42`
  );
  const fetch = vi.spyOn(globalThis, 'fetch');

  render(<App />);
  await screen.findByRole('heading', { name: catalogs.english[page] });
  expect(screen.getByRole('main').textContent).toBe(
    `${catalogs.english.AppName}/${catalogs.english[page]}`
  );
  expect(screen.getByRole('heading', { name: catalogs.english[page] })).toBeInTheDocument();
  expect(fetch).not.toHaveBeenCalled();
});

it('navigates between placeholders and restores browser history', async () => {
  const user = userEvent.setup();

  history.replaceState(null, '', '/home');
  render(<App />);
  await screen.findByRole('heading');
  await user.click(screen.getByRole('link', { name: catalogs.english.Settings }));
  await waitFor(() => expect(location.pathname + location.search).toBe('/settings'));
  expect(
    await screen.findByRole('heading', { name: catalogs.english.Settings })
  ).toBeInTheDocument();
  act(() => history.back());
  expect(await screen.findByRole('heading', { name: catalogs.english.Home })).toBeInTheDocument();
  expect(screen.getByRole('main').textContent).toBe(
    `${catalogs.english.AppName}/${catalogs.english.Home}`
  );
});

it('keeps Settings reachable while the sidebar is collapsed', async () => {
  const user = userEvent.setup();

  render(<App />);
  await screen.findByRole('heading', { name: catalogs.english.Home });

  const toggle = screen.getByRole('button', { name: catalogs.english.ToggleSidebar });

  expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await user.click(toggle);
  expect(toggle).toHaveAttribute('aria-expanded', 'false');

  await user.click(screen.getByRole('link', { name: catalogs.english.Settings }));
  expect(
    await screen.findByRole('heading', { name: catalogs.english.Settings })
  ).toBeInTheDocument();
  expect(screen.getByRole('link', { name: catalogs.english.Settings })).toHaveAttribute(
    'aria-current',
    'page'
  );

  await user.click(toggle);
  expect(toggle).toHaveAttribute('aria-expanded', 'true');
});
