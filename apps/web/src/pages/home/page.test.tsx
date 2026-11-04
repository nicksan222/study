import { catalogs } from '@study/localization';
import { testStable } from '@study/testing/vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { expect } from 'vite-plus/test';

import { renderPage } from '#web/test/render-page.tsx';

testStable('redirects Home to the session starter with the selected project', async () => {
  const { router } = renderPage('/home?project=9007199254740993', 'english');

  await waitFor(() => expect(router.state.location.pathname).toBe('/sessions'));
  expect(router.state.location.search.project).toBe('9007199254740993');
});

testStable.each(['english', 'italian'] as const)(
  'opens the session composer immediately in %s',
  async (locale) => {
    renderPage('/sessions', locale);
    const t = catalogs[locale];

    expect(await screen.findByRole('textbox', { name: t.SessionCompose })).toBeVisible();
    const main = within(screen.getByRole('main'));
    expect(main.getByRole('button', { name: t.SessionSaveNote })).toBeDisabled();
    expect(main.getByLabelText(t.SessionAttachFiles)).toBeInTheDocument();
  }
);
