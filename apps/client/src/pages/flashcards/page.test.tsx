import { testStable } from '@study/testing/vitest';
import { screen } from '@testing-library/react';
import { expect } from 'vite-plus/test';

import { renderPage } from '#client/test/render-page.tsx';

testStable.each(['english', 'italian'] as const)(
  'opens the Flashcards page in %s',
  async (locale) => {
    const { router } = renderPage('/flashcards?project=9007199254740993', locale);

    expect(await screen.findByRole('main')).toHaveTextContent(/^$/);
    expect(router.state.location.search.project).toBe('9007199254740993');
  }
);
