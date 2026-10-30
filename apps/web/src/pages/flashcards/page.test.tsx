import { catalogs } from '@study/localization';
import { screen } from '@testing-library/react';
import { expect, it } from 'vite-plus/test';

import { renderPage } from '../../test/render-page';

it.each(['english', 'italian'] as const)('opens the Flashcards page in %s', async (locale) => {
  const { router } = renderPage('/flashcards?project=9007199254740993', locale);

  expect(
    await screen.findByRole('heading', { name: catalogs[locale].Flashcards })
  ).toBeInTheDocument();
  expect(router.state.location.search.project).toBe('9007199254740993');
});
