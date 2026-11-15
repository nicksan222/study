import { agentRunIdSchema } from '@study/contracts/ai/progress';
import { executionIdSchema } from '@study/contracts/workflows/schemas';
import { catalogs } from '@study/localization';
import { testStable } from '@study/testing/vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect } from 'vite-plus/test';

import { rpcTestTransport } from '#client/test/rpc.tsx';

import { AgentActivity } from './activity';

const run = {
  runId: agentRunIdSchema.make('structured'),
  executionId: executionIdSchema.make('run'),
  executionStatus: 'running',
  agentId: 'internal-technical-agent',
  mode: 'object',
  text: '{"unfinished":',
  status: 'running',
  failureKind: null,
  revision: 1n,
  updatedAtMs: 1n,
  tools: []
};

testStable(
  'shows structured steps with no text or tools in collapsed expandable activity',
  async () => {
    const user = userEvent.setup();
    const fixture = rpcTestTransport(async () => [
      { ...run, runId: 'completed', status: 'completed' },
      run
    ]);

    render(<AgentActivity correlationId="request" label="Generating" status="running" />, {
      wrapper: fixture.wrapper
    });
    const summary = await screen.findByText('Generating');

    expect(summary.closest('details')).not.toHaveAttribute('open');
    expect(await screen.findByText('1 step completed')).toBeInTheDocument();
    await user.click(summary);
    expect(screen.getByText('Step 1')).toBeVisible();
    expect(screen.getByText('Step 2')).toBeVisible();
    expect(screen.getByText(catalogs.english['workspace.state.running'])).toBeVisible();
    expect(screen.queryByText(run.agentId)).not.toBeInTheDocument();
    expect(screen.queryByText(run.text)).not.toBeInTheDocument();
  }
);

testStable(
  'authoritative failure settles stale running progress without animated status',
  async () => {
    const user = userEvent.setup();
    const fixture = rpcTestTransport(async () => [run]);

    render(<AgentActivity correlationId="request" label="Needs attention" status="failed" />, {
      wrapper: fixture.wrapper
    });
    await user.click(await screen.findByText('Needs attention'));
    expect(await screen.findByText('Step 1')).toBeVisible();
    expect(screen.queryByText(catalogs.english['workspace.state.running'])).not.toBeInTheDocument();
    expect(screen.getByText(catalogs.english['workspace.state.failure'])).toBeVisible();
    expect(screen.getByRole('status', { name: 'Needs attention' })).toHaveAttribute(
      'data-state',
      'attention'
    );
  }
);
