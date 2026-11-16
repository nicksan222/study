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
  async () => {
    const fixture = test.rpcTestTransport(async () => [
      { ...run, runId: 'completed', status: 'completed', phase: 'preparing' },
      { ...run, phase: 'compacting' }
    ]);

    test.render(<AgentActivity correlationId="request" label="Generating" status="running" />, {
      wrapper: fixture.wrapper
    });
    test
      .expect(await test.screen.findByRole('status', { name: en.AgentActivityCompacting }))
      .toHaveAttribute('data-state', 'running');
    test.expect(test.screen.queryByText('Step 1')).not.toBeInTheDocument();
    test.expect(test.screen.queryByLabelText(en.AgentActivitySteps)).not.toBeInTheDocument();
    test.expect(test.screen.queryByText(run.agentId)).not.toBeInTheDocument();
    test.expect(test.screen.queryByText(run.text)).not.toBeInTheDocument();
    test.expect(test.screen.queryByText(en.AgentActivityPreparing)).not.toBeInTheDocument();
  }
);

test.stable('keeps the latest live phase when a newer concurrent run has finished', async () => {
  const fixture = test.rpcTestTransport(async () => [
    { ...run, phase: 'preparing' },
    { ...run, runId: 'completed', status: 'completed', phase: 'compacting' }
  ]);

  test.render(<AgentActivity correlationId="request" label="Generating" status="running" />, {
    wrapper: fixture.wrapper
  });
  test
    .expect(await test.screen.findByRole('status', { name: en.AgentActivityPreparing }))
    .toBeVisible();
  test.expect(test.screen.queryByText(en.AgentActivityCompacting)).not.toBeInTheDocument();
});

test.stable('authoritative failure overrides stale running phase without animation', async () => {
  const fixture = test.rpcTestTransport(async () => [{ ...run, phase: 'compacting' }]);

  test.render(<AgentActivity correlationId="request" label="Needs attention" status="failed" />, {
    wrapper: fixture.wrapper
  });
  test
    .expect(await test.screen.findByRole('status', { name: 'Needs attention' }))
    .toHaveAttribute('data-state', 'attention');
  test.expect(test.screen.queryByText(en.AgentActivityCompacting)).not.toBeInTheDocument();
});

test.stable('keeps text drafts out of the compact sidebar activity', async () => {
  const fixture = test.rpcTestTransport(async () => [
    { ...run, mode: 'text', text: 'A private model draft', phase: 'generating' }
  ]);

  test.render(<AgentActivity correlationId="request" label="Generating" status="running" />, {
    wrapper: fixture.wrapper
  });
  test.expect(await test.screen.findByRole('status', { name: 'Generating' })).toBeVisible();
  test.expect(test.screen.queryByText('A private model draft')).not.toBeInTheDocument();
});

test.stable('ignores unfinished previews from an execution that already ended', async () => {
  const fixture = test.rpcTestTransport(async () => [
    { ...run, executionStatus: 'completed', phase: 'compacting' }
  ]);

  test.render(<AgentActivity correlationId="request" label="Retrying" status="waiting" />, {
    wrapper: fixture.wrapper
  });
  test
    .expect(await test.screen.findByRole('status', { name: 'Retrying' }))
    .toHaveAttribute('data-state', 'waiting');
  test.expect(test.screen.queryByText(en.AgentActivityCompacting)).not.toBeInTheDocument();
});
