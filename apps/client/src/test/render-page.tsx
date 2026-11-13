import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { render } from '@testing-library/react';
import { vi } from 'vite-plus/test';

import { Providers } from '../app/providers';
import { createAppRouter } from '../app/router';
import type { Locale } from '../lib/i18n';
import type { StudyClient } from '../lib/study-client/client';

vi.mock('../lib/study-client/client', async () => {
  const { Effect } = await import('effect');
  const page = () => Effect.succeed({ items: [], next: null, nextCursor: null });

  const workflows = {
    'workflows.executions': vi
      .fn<StudyClient['workflows.executions']>()
      .mockReturnValue(Effect.succeed({ items: [], next: null })),
    'workflows.execution': vi.fn<StudyClient['workflows.execution']>().mockReturnValue(
      Effect.fail({
        kind: 'not_found' as const,
        message: 'No execution selected',
        retryAfterMs: null
      })
    ),
    'workflows.cancelExecution': vi.fn<StudyClient['workflows.cancelExecution']>().mockReturnValue(
      Effect.fail({
        kind: 'not_found' as const,
        message: 'No execution selected',
        retryAfterMs: null
      })
    )
  };

  return {
    studyClient: Effect.succeed({
      'projects.projects': page,
      'notes.notes': page,
      'sources.sources': page,
      'materials.materials': page,
      'pages.pages': page,
      ...workflows
    })
  };
});

export function renderPage(path: string, locale: Locale = 'english') {
  const history = createMemoryHistory({ initialEntries: [path] });
  const router = createAppRouter(history);

  return {
    ...render(
      <Providers locale={locale} queryClient={router.options.context.queryClient}>
        <RouterProvider router={router} />
      </Providers>
    ),
    router
  };
}
