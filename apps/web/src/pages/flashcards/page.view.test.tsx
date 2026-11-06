import { testStable } from '@study/testing/vitest';
import { screen } from '@testing-library/react';
import { expect } from 'vite-plus/test';

import { renderPage } from '#web/test/render-page.tsx';

testStable('leaves the practice workspace empty for selection from the sidebar', async () => {
  renderPage('/flashcards');
  expect(await screen.findByRole('main')).toHaveTextContent(/^$/);
  expect(screen.getByRole('complementary', { name: 'Study navigation' })).toBeInTheDocument();
});
