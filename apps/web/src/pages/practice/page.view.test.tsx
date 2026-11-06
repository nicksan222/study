import { catalogs } from '@study/localization';
import { testStable } from '@study/testing/vitest';
import { screen } from '@testing-library/react';
import { expect } from 'vite-plus/test';

import { renderPage } from '#web/test/render-page.tsx';

testStable('shows the practice library introduction', async () => {
  renderPage('/practice');
  expect(await screen.findByText(catalogs.english.PracticeLibraryIntro)).toBeInTheDocument();
});
