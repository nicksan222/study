import { projectIdSchema, sessionIdSchema } from '@study/contracts/ids';
import { testStable } from '@study/testing/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, vi } from 'vite-plus/test';

import { DocumentsFromSessions } from './from-sessions';

const api = vi.hoisted(() => ({ sessions: vi.fn() }));

vi.mock('#web/lib/i18n.tsx', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock('#web/lib/study-client/study.queries.ts', () => ({
  sessionsQueryOptions: () => ({ queryKey: ['sessions'], queryFn: api.sessions })
}));
vi.mock('../session-workspace', () => ({
  SessionDocumentDialog: ({
    id,
    sessions,
    open
  }: {
    id: bigint;
    sessions: { title: string }[];
    open: boolean;
  }) =>
    open ? (
      <section aria-label="Shared transform" data-session={String(id)}>
        {sessions.map((session) => session.title).join(', ')}
      </section>
    ) : null
}));

afterEach(cleanup);

testStable(
  'selects only scoped sessions and hands multiple selections to the existing transform dialog',
  async () => {
    const projectId = projectIdSchema.make(2n);
    const session = (id: bigint, title: string, project = projectId) => ({
      id: sessionIdSchema.make(id),
      title,
      projectIds: [project],
      titleSource: 'user',
      createdAt: 1n,
      updatedAt: 1n
    });

    api.sessions.mockResolvedValue([
      session(1n, 'Lecture'),
      session(2n, 'Exercises'),
      session(3n, 'Other subject', projectIdSchema.make(3n))
    ]);
    const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const user = userEvent.setup();

    render(
      <QueryClientProvider client={cache}>
        <DocumentsFromSessions project={projectId} />
      </QueryClientProvider>
    );
    await user.click(screen.getByRole('button', { name: 'DocumentsFromSessions' }));
    expect(screen.getByRole('button', { name: 'SessionApplyAction' })).toBeDisabled();
    await user.click(await screen.findByRole('button', { name: 'Lecture' }));
    expect(screen.queryByRole('button', { name: 'Other subject' })).not.toBeInTheDocument();
    await user.type(screen.getByRole('searchbox', { name: 'DocumentsFindSessions' }), 'Exercises');
    expect(screen.queryByRole('button', { name: 'Lecture' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Exercises' }));
    await user.click(screen.getByRole('button', { name: 'SessionApplyAction' }));
    const transform = await screen.findByRole('region', { name: 'Shared transform' });

    expect(transform).toHaveAttribute('data-session', '1');
    expect(transform).toHaveTextContent('Lecture, Exercises');
    cache.clear();
  }
);
