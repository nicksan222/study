import { agentRunIdSchema, executionIdSchema } from '@study/contracts';
import { catalogs } from '@study/localization';
import { test } from '@study/testing';

import { AgentActivity } from './activity';

const en = catalogs.english;

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

test.stable(
  'shows only the active phase without steps, raw output or internal identifiers',
  async ({ rpcTestTransport, render, expect, screen }) => {
    const fixture = rpcTestTransport(async () => [
      { ...run, runId: 'completed', status: 'completed', phase: 'preparing' },
      { ...run, phase: 'compacting' }
    ]);

    render(<AgentActivity correlationId="request" label="Generating" status="running" />, {
      wrapper: fixture.wrapper
    });
    expect(await screen.findByRole('status', { name: en.AgentActivityCompacting })).toHaveAttribute(
      'data-state',
      'running'
    );
    expect(screen.queryByText('Step 1')).not.toBeInTheDocument();
    expect(screen.queryByLabelText(en.AgentActivitySteps)).not.toBeInTheDocument();
    expect(screen.queryByText(run.agentId)).not.toBeInTheDocument();
    expect(screen.queryByText(run.text)).not.toBeInTheDocument();
    expect(screen.queryByText(en.AgentActivityPreparing)).not.toBeInTheDocument();
  }
);

test.stable(
  'keeps the latest live phase when a newer concurrent run has finished',
  async ({ rpcTestTransport, render, expect, screen }) => {
    const fixture = rpcTestTransport(async () => [
      { ...run, phase: 'preparing' },
      { ...run, runId: 'completed', status: 'completed', phase: 'compacting' }
    ]);

    render(<AgentActivity correlationId="request" label="Generating" status="running" />, {
      wrapper: fixture.wrapper
    });
    expect(await screen.findByRole('status', { name: en.AgentActivityPreparing })).toBeVisible();
    expect(screen.queryByText(en.AgentActivityCompacting)).not.toBeInTheDocument();
  }
);

test.stable(
  'authoritative failure overrides stale running phase without animation',
  async ({ rpcTestTransport, render, expect, screen }) => {
    const fixture = rpcTestTransport(async () => [{ ...run, phase: 'compacting' }]);

    render(<AgentActivity correlationId="request" label="Needs attention" status="failed" />, {
      wrapper: fixture.wrapper
    });
    expect(await screen.findByRole('status', { name: 'Needs attention' })).toHaveAttribute(
      'data-state',
      'attention'
    );
    expect(screen.queryByText(en.AgentActivityCompacting)).not.toBeInTheDocument();
  }
);

test.stable(
  'keeps text drafts out of the compact sidebar activity',
  async ({ rpcTestTransport, render, expect, screen }) => {
    const fixture = rpcTestTransport(async () => [
      { ...run, mode: 'text', text: 'A private model draft', phase: 'generating' }
    ]);

    render(<AgentActivity correlationId="request" label="Generating" status="running" />, {
      wrapper: fixture.wrapper
    });
    expect(await screen.findByRole('status', { name: 'Generating' })).toBeVisible();
    expect(screen.queryByText('A private model draft')).not.toBeInTheDocument();
  }
);

test.stable(
  'ignores unfinished previews from an execution that already ended',
  async ({ rpcTestTransport, render, expect, screen }) => {
    const fixture = rpcTestTransport(async () => [
      { ...run, executionStatus: 'completed', phase: 'compacting' }
    ]);

    render(<AgentActivity correlationId="request" label="Retrying" status="waiting" />, {
      wrapper: fixture.wrapper
    });
    expect(await screen.findByRole('status', { name: 'Retrying' })).toHaveAttribute(
      'data-state',
      'waiting'
    );
    expect(screen.queryByText(en.AgentActivityCompacting)).not.toBeInTheDocument();
  }
);
