import { catalogs } from '@study/localization';
import { testStable } from '@study/testing/vitest';
import { screen } from '@testing-library/react';
import { expect } from 'vite-plus/test';

import { renderPage } from '#client/test/render-page.tsx';

testStable.each(['english', 'italian'] as const)(
  'opens the Settings page in %s',
  async (locale) => {
    const { router } = renderPage('/settings?project=9007199254740993', locale);

    expect(
      await screen.findByRole('heading', { name: catalogs[locale].Settings })
    ).toBeInTheDocument();
    expect(router.state.location.search.project).toBe('9007199254740993');
  }
);
