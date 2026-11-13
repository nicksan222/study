import { catalogs, createLocalization } from '@study/localization';
import { testStable } from '@study/testing/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import { expect, vi } from 'vite-plus/test';

import { ExecutionStatus } from './status';

const api = vi.hoisted(() => ({ executions: vi.fn() }));

vi.mock('#client/lib/i18n.tsx', () => ({
  useI18n: () => createLocalization('english')
}));
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to, ...props }: React.ComponentProps<'a'> & { to: string }) => (
    <a href={to} {...props}>
      {children}
    </a>
  )
}));
vi.mock('./note-workspace.queries', () => ({
  executionOptions: (id: string) => ({ queryKey: ['work-log', id], queryFn: api.executions })
}));

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  return render(
    <QueryClientProvider client={client}>
      <ExecutionStatus requestId="prompt" />
    </QueryClientProvider>
  );
}

testStable('shows real request work in chronological muted rows', async () => {
  api.executions.mockResolvedValue({
    items: [
      {
        id: 'reply',
        workflow: 'conversation-reply',
        createdAtMs: 1000n,
        updatedAtMs: 2000n,
        status: 'running',
        outcome: null
      },
      {
        id: 'import',
        workflow: 'source-ingestion',
        createdAtMs: 1000n,
        updatedAtMs: 2000n,
        status: 'completed',
        outcome: 'success'
      }
    ],
    next: null
  });
  mount();
  await screen.findByText('Generate reply');
  const work = screen.getByRole('status', { name: 'Work for this prompt' });

  expect(work.textContent).toMatch(/Import material.*Completed.*Generate reply.*Working/s);
  expect(within(work).queryByRole('button')).not.toBeInTheDocument();
});

testStable('keeps actionable authentication errors below the work row', async () => {
  api.executions.mockResolvedValue({
    items: [
      {
        id: 'reply',
        workflow: 'conversation-reply',
        createdAtMs: 1000n,
        updatedAtMs: 2000n,
        status: 'completed',
        outcome: 'failure',
        failureKind: 'auth'
      }
    ],
    next: null
  });
  mount();
  expect(await screen.findByText(catalogs.english.NoteAuthError)).toBeInTheDocument();
  expect(screen.getByText('Generate reply')).toBeInTheDocument();
});

testStable('explains a configuration wait and offers settings', async () => {
  api.executions.mockResolvedValue({
    items: [
      {
        id: 'wait',
        workflow: 'document-transform/v1',
        createdAtMs: 1000n,
        updatedAtMs: 2000n,
        status: 'suspended',
        outcome: null,
        configurationWaitReason: 'auth'
      }
    ],
    next: null
  });
  mount();
  await screen.findByText('Rewrite page');
  screen.getByText('Rewrite page').click();
  expect(await screen.findByText(catalogs.english.NoteWaitAuth)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: catalogs.english.Settings })).toHaveAttribute(
    'href',
    '/settings'
  );
});
