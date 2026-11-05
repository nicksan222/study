import { catalogs } from '@study/localization';
import { testStable } from '@study/testing/vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, vi } from 'vite-plus/test';

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

const pages = ['Sessions', 'Projects', 'Flashcards', 'Practice', 'Help'] as const;

beforeEach(() => {
  history.replaceState(null, '', '/');
});

testStable.each(pages)(
  'renders the %s route with a localized heading without network access',
  async (page) => {
    history.replaceState(null, '', `/${page.toLowerCase()}`);
    const fetch = vi.spyOn(globalThis, 'fetch');

    render(<App />);
    const title = catalogs.english[page];

    expect(await screen.findByRole('heading', { name: title, level: 1 })).toBeInTheDocument();
    expect(screen.getByRole('main')).toHaveTextContent(
      page === 'Sessions' ? catalogs.english.SessionStartHelp : catalogs.english.AppName
    );

    expect(fetch).not.toHaveBeenCalled();
  }
);

testStable(
  'opens settings over the current page and restores focus without changing the URL',
  async () => {
    const user = userEvent.setup();

    history.replaceState(null, '', '/projects/1/sessions/42');
    render(<App />);
    expect(
      await screen.findByRole('button', { name: catalogs.english.ToggleSidebar })
    ).toHaveAttribute('aria-expanded', 'true');
    const trigger = await screen.findByRole('button', { name: catalogs.english.Settings });

    await user.click(trigger);
    expect(
      await screen.findByRole('dialog', { name: catalogs.english.Settings })
    ).toBeInTheDocument();
    expect(location.pathname + location.search).toBe('/projects/1/sessions/42');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(screen.getByRole('heading', { name: catalogs.english.Sessions })).toBeInTheDocument();
  }
);

testStable('opens the appearance popup from its direct settings route', async () => {
  history.replaceState(null, '', '/settings');
  render(<App />);
  expect(
    await screen.findByRole('dialog', { name: catalogs.english.Settings })
  ).toBeInTheDocument();
});

testStable('keeps Settings reachable while the sidebar is collapsed', async () => {
  const user = userEvent.setup();

  history.replaceState(null, '', '/projects');
  render(<App />);
  await screen.findByRole('heading', { name: catalogs.english.Projects });

  const toggle = screen.getByRole('button', { name: catalogs.english.ToggleSidebar });

  expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await user.click(toggle);
  expect(toggle).toHaveAttribute('aria-expanded', 'false');

  await user.click(screen.getByRole('button', { name: catalogs.english.Settings }));
  expect(
    await screen.findByRole('heading', { name: catalogs.english.Settings })
  ).toBeInTheDocument();
  await user.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

  await user.click(toggle);
  expect(toggle).toHaveAttribute('aria-expanded', 'true');
});
