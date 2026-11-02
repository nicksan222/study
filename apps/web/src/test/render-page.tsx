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
    'workflows.executions': () => Effect.succeed({ items: [], next: null }),
    'workflows.execution': () =>
      Effect.fail({
        kind: 'not_found' as const,
        message: 'No execution selected',
        retryAfterMs: null
      }),
    'workflows.cancelExecution': () =>
      Effect.fail({
        kind: 'not_found' as const,
        message: 'No execution selected',
        retryAfterMs: null
      })
  } satisfies Pick<
    StudyClient,
    'workflows.executions' | 'workflows.execution' | 'workflows.cancelExecution'
  >;

  return {
    studyClient: Effect.succeed({
      'projects.projects': page,
      'conversations.sessions': page,
      'sources.sources': page,
      'materials.materials': page,
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
