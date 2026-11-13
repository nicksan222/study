import { catalogs } from '@study/localization';
import { testStable } from '@study/testing/vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { expect } from 'vite-plus/test';

import { renderPage } from '#client/test/render-page.tsx';

testStable('redirects Home to the note starter with the selected project', async () => {
  const { router } = renderPage('/home?project=9007199254740993', 'english');

  await waitFor(() => expect(router.state.location.pathname).toBe('/notes'));
  expect(router.state.location.search.project).toBe('9007199254740993');
});

testStable.each(['english', 'italian'] as const)(
  'opens the note composer immediately in %s',
  async (locale) => {
    renderPage('/notes', locale);
    const t = catalogs[locale];

    expect(await screen.findByRole('textbox', { name: t.NoteCompose })).toBeVisible();
    const main = within(screen.getByRole('main'));

    expect(main.getByRole('button', { name: t.NoteSaveNote })).toBeDisabled();
    expect(main.getByLabelText(t.NoteAttachFiles)).toBeInTheDocument();
  }
);
