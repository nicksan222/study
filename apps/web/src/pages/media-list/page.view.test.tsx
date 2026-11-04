import { catalogs } from '@study/localization';
import { testStable } from '@study/testing/vitest';
import { screen, waitFor } from '@testing-library/react';
import { expect, vi } from 'vite-plus/test';

import { renderPage } from '#web/test/render-page.tsx';

testStable(
  'serves the production library at the former media list path while retaining its subject',
  async () => {
    const fetch = vi.spyOn(globalThis, 'fetch');
    const { router } = renderPage('/media-list?project=9007199254740993', 'english');

    expect(
      await screen.findByRole('heading', { name: catalogs.english.SidebarLibrary, level: 1 })
    ).toBeInTheDocument();
    await waitFor(() => expect(router.state.location.pathname).toBe('/media-list'));
    expect(router.state.location.search.project).toBe('9007199254740993');
    expect(fetch).not.toHaveBeenCalled();
  }
);
