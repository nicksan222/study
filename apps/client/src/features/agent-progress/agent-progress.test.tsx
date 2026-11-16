import { agentRunIdSchema, executionIdSchema } from '@study/contracts';
import { test } from '@study/testing';

import type * as __MockType0 from './index';

let AgentProgress: typeof __MockType0.AgentProgress;

test.beforeEach(async ({ mock }) => {
  mock('#client/lib/i18n.tsx', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
  const __mockModule0 = await import('./index');

  AgentProgress = __mockModule0.AgentProgress;
});

test.afterEach(() => {
  test.cleanup();
});

test.stable(
  'renders intermediate text and tool activity, replaces reconnect snapshots, and releases the viewer',
  async () => {
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
    const fixture = test.rpcTestTransport(async () => snapshots);
    const mounted = test.render(<AgentProgress executionId={executionIdSchema.make('run')} />, {
      wrapper: fixture.wrapper
    });
    const receive = async (value: unknown) => {
      snapshots = value;
      await fixture.notify();
    };

    await test.screen.findByText('First');
    test.expect(test.screen.getByText('First')).toBeInTheDocument();
    test.expect(test.screen.getByText('AssistantToolWorking')).toBeInTheDocument();
    test
      .expect(
        test.screen.getByRole('button', { name: 'AssistantCallReadSettings AssistantToolDone' })
      )
      .toHaveAttribute('aria-expanded', 'false');
    test.expect(test.screen.getAllByRole('button')).toHaveLength(2);
    await test.act(() => receive([{ ...run, text: 'First second', revision: 2n }]));
    test
      .expect(test.screen.getByRole('region', { name: 'AgentStreamingPreview' }))
      .toHaveTextContent('First second');
    test.expect(test.screen.queryByText('FirstFirst second')).not.toBeInTheDocument();
    await test.act(() =>
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
    test
      .expect(test.screen.getByRole('region', { name: 'workspace.state.completed' }))
      .toBeInTheDocument();
    test.expect(test.screen.queryByText('AgentStreamingPreview')).not.toBeInTheDocument();
    mounted.unmount();
  }
);

test.stable('does not expose raw structured output as a finished document', async () => {
  const fixture = test.rpcTestTransport(async () => [
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

  test.render(<AgentProgress executionId={executionIdSchema.make('run')} />, {
    wrapper: fixture.wrapper
  });
  await test.waitFor(() =>
    test.expect(test.screen.queryByText('{"unfinished":')).not.toBeInTheDocument()
  );
});
