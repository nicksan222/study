import { agentRunIdSchema } from '@study/contracts/ai/progress';
import { executionIdSchema } from '@study/contracts/workflows/schemas';
import { testStable } from '@study/testing/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, vi } from 'vite-plus/test';

import { AgentProgress } from './index';

const api = vi.hoisted(() => ({ subscribe: vi.fn() }));

vi.mock('#client/lib/study-client/subscriptions.ts', () => ({ subscribe: api.subscribe }));
vi.mock('#client/lib/i18n.tsx', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

testStable(
  'renders intermediate text and tool activity, replaces reconnect snapshots, and releases the viewer',
  async () => {
    let receive!: (value: unknown) => void;
    let signal!: AbortSignal;

    api.subscribe.mockImplementation((_invoke, onValue, abort) => {
      receive = onValue;
      signal = abort;

      return new Promise(() => {});
    });
    const cache = new QueryClient();
    const invalidate = vi.spyOn(cache, 'invalidateQueries');
    const mounted = render(
      <QueryClientProvider client={cache}>
        <AgentProgress executionId={executionIdSchema.make('run')} />
      </QueryClientProvider>
    );
    const run = {
      runId: agentRunIdSchema.make('agent'),
      executionId: executionIdSchema.make('run'),
      executionStatus: 'running',
      agentId: 'reply',
      mode: 'text',
      text: 'First',
      status: 'running',
      failureKind: null,
      revision: 1n,
      updatedAtMs: 1n,
      tools: [
        { toolCallId: 'earlier', toolName: 'read_settings', status: 'completed' },
        { toolCallId: 'call', toolName: 'sources', status: 'running' }
      ]
    };

    await act(() => receive([run]));
    expect(screen.getByText('First')).toBeInTheDocument();
    expect(screen.getByText('AssistantToolWorking')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'AssistantCallReadSettings AssistantToolDone' })
    ).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getAllByRole('button')).toHaveLength(2);
    await act(() => receive([{ ...run, text: 'First second', revision: 2n }]));
    expect(screen.getByRole('region', { name: 'AgentStreamingPreview' })).toHaveTextContent(
      'First second'
    );
    expect(screen.queryByText('FirstFirst second')).not.toBeInTheDocument();
    await act(() =>
      receive([
        {
          ...run,
          text: 'First second',
          status: 'completed',
          executionStatus: 'completed',
          revision: 3n
        }
      ])
    );
    await waitFor(() => expect(invalidate).toHaveBeenCalled());
    expect(screen.getByRole('region', { name: 'workspace.state.completed' })).toBeInTheDocument();
    expect(screen.queryByText('AgentStreamingPreview')).not.toBeInTheDocument();
    mounted.unmount();
    expect(signal.aborted).toBe(true);
    cache.clear();
  }
);

testStable('does not expose raw structured output as a finished document', async () => {
  api.subscribe.mockImplementation((_invoke, onValue) => {
    onValue([
      {
        runId: 'structured',
        executionId: 'run',
        executionStatus: 'running',
        agentId: 'quiz',
        mode: 'object',
        text: '{"unfinished":',
        status: 'running',
        failureKind: null,
        revision: 1n,
        updatedAtMs: 1n,
        tools: []
      }
    ]);

    return new Promise(() => {});
  });
  const cache = new QueryClient();

  render(
    <QueryClientProvider client={cache}>
      <AgentProgress executionId={executionIdSchema.make('run')} />
    </QueryClientProvider>
  );
  expect(screen.queryByText('{"unfinished":')).not.toBeInTheDocument();
  cache.clear();
});
