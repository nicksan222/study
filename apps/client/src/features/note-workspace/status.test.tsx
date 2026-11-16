import { catalogs, createLocalization } from '@study/localization';
import { test } from '@study/testing';

import type * as __MockType0 from './status';

let ExecutionStatus: typeof __MockType0.ExecutionStatus;

let api: ReturnType<typeof createMockState>['api'];

function mount() {
  const fixture = test.rpcTestTransport(async () => {
    const page = await api.executions();

    return {
      ...page,
      items: page.items.map((item: object) => ({
        correlationId: 'prompt',
        failureKind: null,
        configurationWaitReason: null,
        canCancel: false,
        ...item
      }))
    };
  });

  return test.render(<ExecutionStatus requestId="prompt" />, { wrapper: fixture.wrapper });
}

function createMockState(mock: test.Mock) {
  return {
    api: (() => ({ executions: mock.fn() }))()
  };
}

test.beforeEach(async ({ mock }) => {
  const __mockState = createMockState(mock);

  api = __mockState.api;

  mock('#client/lib/i18n.tsx', () => ({
    useI18n: () => createLocalization('english')
  }));
  mock('@tanstack/react-router', () => ({
    Link: ({ children, to, ...props }: React.ComponentProps<'a'> & { to: string }) => (
      <a href={to} {...props}>
        {children}
      </a>
    )
  }));
  const __mockModule0 = await import('./status');

  ExecutionStatus = __mockModule0.ExecutionStatus;
});

test.stable('shows real request work in chronological muted rows', async () => {
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
  await test.screen.findByText('Generate reply');
  const work = test.screen.getByRole('status', { name: 'Work for this prompt' });

  test.expect(work.textContent).toMatch(/Import material.*Completed.*Generate reply.*Working/s);
  test.expect(test.within(work).queryByRole('button')).not.toBeInTheDocument();
});

test.stable('keeps actionable authentication errors below the work row', async () => {
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
  test.expect(await test.screen.findByText(catalogs.english.NoteAuthError)).toBeInTheDocument();
  test.expect(test.screen.getByText('Generate reply')).toBeInTheDocument();
});

test.stable('explains a configuration wait and offers settings', async () => {
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
  await test.screen.findByText('Rewrite page');
  test.screen.getByText('Rewrite page').click();
  test.expect(await test.screen.findByText(catalogs.english.NoteWaitAuth)).toBeInTheDocument();
  test
    .expect(test.screen.getByRole('link', { name: catalogs.english.Settings }))
    .toHaveAttribute('href', '/settings');
});

test.stable('labels unsupported persisted work as blocked with its typed error', async () => {
  api.executions.mockResolvedValue({
    items: [
      {
        id: 'blocked',
        workflow: 'conversation-reply',
        createdAtMs: 1000n,
        updatedAtMs: 2000n,
        status: 'blocked',
        outcome: 'failure',
        failureKind: 'unsupported'
      }
    ],
    next: null
  });
  mount();
  test
    .expect(await test.screen.findByText(catalogs.english['workspace.state.blocked']))
    .toBeInTheDocument();
  test
    .expect(test.screen.queryByText(catalogs.english['workspace.state.failure']))
    .not.toBeInTheDocument();
});
