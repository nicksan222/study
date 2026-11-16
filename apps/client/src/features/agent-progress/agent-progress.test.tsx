import { agentRunIdSchema, executionIdSchema } from '@study/contracts';
import { test } from '@study/testing';

import type * as __MockType0 from './index';

let AgentProgress: typeof __MockType0.AgentProgress;

test.unit.beforeEach(async ({ mock }) => {
  mock('#client/lib/i18n.tsx', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
  const __mockModule0 = await import('./index');

  AgentProgress = __mockModule0.AgentProgress;
});

test.unit.afterEach(({ cleanup }) => {
  cleanup();
});

test.unit.stable(
  'renders intermediate text and tool activity, replaces reconnect snapshots, and releases the viewer',
  async ({ rpcTestTransport, render, screen, expect, act }) => {
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

    let snapshots: unknown = [run];
    const fixture = rpcTestTransport(async () => snapshots);
    const mounted = render(<AgentProgress executionId={executionIdSchema.make('run')} />, {
      wrapper: fixture.wrapper
    });
    const receive = async (value: unknown) => {
      snapshots = value;
      await fixture.notify();
    };

    await screen.findByText('First');
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
    expect(screen.getByRole('region', { name: 'workspace.state.completed' })).toBeInTheDocument();
    expect(screen.queryByText('AgentStreamingPreview')).not.toBeInTheDocument();
    mounted.unmount();
  }
);

test.unit.stable(
  'does not expose raw structured output as a finished document',
  async ({ rpcTestTransport, render, waitFor, expect, screen }) => {
    const fixture = rpcTestTransport(async () => [
      {
        runId: agentRunIdSchema.make('structured'),
        executionId: executionIdSchema.make('run'),
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

    render(<AgentProgress executionId={executionIdSchema.make('run')} />, {
      wrapper: fixture.wrapper
    });
    await waitFor(() => expect(screen.queryByText('{"unfinished":')).not.toBeInTheDocument());
  }
);
