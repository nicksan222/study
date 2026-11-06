import { catalogs } from '@study/localization';
import { testStable } from '@study/testing/vitest';
import { screen } from '@testing-library/react';
import { expect } from 'vite-plus/test';

import { renderPage } from '#web/test/render-page.tsx';

testStable('explains how to create practice material in an empty library', async () => {
  renderPage('/flashcards');
  expect(await screen.findByText(catalogs.english.PracticeLibraryEmptyHint)).toBeInTheDocument();

  for (const link of screen.getAllByRole('link', { name: catalogs.english.SourceDocument }))
    expect(link).toHaveAttribute('href', '/documents');
});
