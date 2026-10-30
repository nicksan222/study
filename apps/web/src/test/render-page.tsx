import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { render } from '@testing-library/react';
import { vi } from 'vite-plus/test';

import { createAppRouter } from '../app/router';
import { LanguageProvider } from '../lib/i18n';
import type { Locale } from '../lib/i18n';

vi.mock('../lib/study-client/client', async () => {
  const { Effect } = await import('effect');
  const page = () => Effect.succeed({ items: [], next: null, nextCursor: null });

  return {
    studyClient: Effect.succeed({
      'projects.projects': page,
      'conversations.sessions': page,
      'sources.sources': page,
      'materials.materials': page
    })
  };
});

export function renderPage(path: string, locale: Locale = 'english') {
  const history = createMemoryHistory({ initialEntries: [path] });
  const router = createAppRouter(history);

  return {
    ...render(
      <LanguageProvider locale={locale}>
        <RouterProvider router={router} />
      </LanguageProvider>
    ),
    router
  };
}
