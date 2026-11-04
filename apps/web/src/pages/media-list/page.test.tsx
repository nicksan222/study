import { catalogs } from '@study/localization';
import { testStable } from '@study/testing/vitest';
import { screen } from '@testing-library/react';
import { expect } from 'vite-plus/test';

import { renderPage } from '#web/test/render-page.tsx';

testStable.each(['english', 'italian'] as const)(
  'opens the MediaList page in %s',
  async (locale) => {
    const { router } = renderPage('/media-list?project=9007199254740993', locale);

    expect(
      await screen.findByRole('heading', { name: catalogs[locale].SidebarLibrary, level: 1 })
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/media-list');
    expect(router.state.location.search.project).toBe('9007199254740993');
  }
);
