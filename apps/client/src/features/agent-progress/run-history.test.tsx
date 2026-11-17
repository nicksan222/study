import { agentRunIdSchema, executionIdSchema } from '@study/contracts';
import type { agentProgressSchema } from '@study/contracts';
import { catalogs } from '@study/localization';
import { test } from '@study/testing';

import { RunHistory } from './run-history';

type Run = typeof agentProgressSchema.Type;

const en = catalogs.english;

const base: Run = {
  runId: agentRunIdSchema.make('root'),
  executionId: executionIdSchema.make('execution'),
  executionStatus: 'completed',
  agentId: 'internal-id',
  mode: 'object',
  text: '',
  status: 'completed',
  failureKind: null,
  revision: 1n,
  updatedAtMs: 5000n,
  tools: [],
  trace: {
    kind: 'procedure',
    purpose: 'quiz',
    parentRunId: null,
    attempt: 2,
    startedAtMs: 1000n,
    finishedAtMs: 5000n,
    input: { text: 'Source material', truncated: true },
    output: { text: '{"questions":[]}', truncated: false }
  },
  usage: { input: 100, output: 20, requests: 2 }
};

test.unit.stable(
  'inspector shows semantic work, duration and usage and discloses bounded payloads',
  async ({ react, expect }) => {
    const { screen } = react;

    react.render(<RunHistory runs={[base]} />);
    const step = screen.getByRole('button', {
      name: `${en.AgentRunQuiz} ${en.AgentActivityStepComplete}`
    });

    expect(step).toHaveAttribute('aria-expanded', 'false');
    await react.user.click(step);
    expect(step).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Attempt 2')).toBeVisible();
    expect(screen.getByText('4 s')).toBeVisible();
    expect(screen.getByText('100 input tokens · 20 output tokens · 2 requests')).toBeVisible();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    await react.user.click(screen.getByRole('button', { name: en.AgentRunDetails }));
    expect(await screen.findByRole('textbox', { name: en.AssistantToolInput })).toHaveValue(
      'Source material'
    );
    expect(screen.getByRole('textbox', { name: en.AssistantToolOutput })).toHaveValue(
      '{"questions":[]}'
    );
    expect(screen.getByText(en.AssistantToolTruncated)).toBeVisible();
    expect(screen.queryByText(base.agentId)).not.toBeInTheDocument();
  }
);

test.unit.stable(
  'new running steps open as history arrives while an explicit collapse is retained',
  async ({ react, expect }) => {
    const running: Run = { ...base, status: 'running' };
    const next: Run = { ...running, runId: agentRunIdSchema.make('next') };
    const incoming: Run = { ...running, runId: agentRunIdSchema.make('incoming') };
    const view = react.render(<RunHistory runs={[running, next]} />);

    await react.user.click(
      react.screen.getAllByRole('button', {
        name: `${en.AgentRunQuiz} ${en['workspace.state.running']}`
      })[0]!
    );
    view.rerender(<RunHistory runs={[running, { ...next, status: 'completed' }, incoming]} />);
    const steps = react.screen.getAllByRole('button', {
      name: `${en.AgentRunQuiz} ${en['workspace.state.running']}`
    });

    expect(steps[0]).toHaveAttribute('aria-expanded', 'false');
    expect(steps[1]).toHaveAttribute('aria-expanded', 'true');
    expect(
      react.screen.getByRole('button', {
        name: `${en.AgentRunQuiz} ${en.AgentActivityStepComplete}`
      })
    ).toHaveAttribute('aria-expanded', 'false');
  }
);

test.unit.stable(
  'nested expansion choices survive a parent panel unmounting',
  async ({ react, expect, waitFor }) => {
    const { screen } = react;
    const child: Run = {
      ...base,
      runId: agentRunIdSchema.make('nested'),
      trace: { ...base.trace!, purpose: 'plan', parentRunId: base.runId }
    };

    react.render(<RunHistory runs={[base, child]} />);
    const parent = screen.getByRole('button', {
      name: `${en.AgentRunQuiz} ${en.AgentActivityStepComplete}`
    });

    await react.user.click(parent);
    const nested = screen.getByRole('button', {
      name: `${en.AgentRunPlan} ${en.AgentActivityStepComplete}`
    });

    await react.user.click(nested);
    await react.user.click(parent);
    await waitFor(() => expect(nested).not.toBeInTheDocument());
    await react.user.click(parent);
    expect(
      screen.getByRole('button', {
        name: `${en.AgentRunPlan} ${en.AgentActivityStepComplete}`
      })
    ).toHaveAttribute('aria-expanded', 'true');
  }
);

test.unit.stable(
  'child work is revealed inside its parent tool, even when snapshots arrive out of order',
  async ({ react, expect, within }) => {
    const { screen } = react;
    const child: Run = {
      ...base,
      runId: agentRunIdSchema.make('child'),
      trace: {
        ...base.trace!,
        kind: 'agent',
        purpose: 'plan',
        parentRunId: base.runId,
        parentToolCallId: 'tool'
      }
    };

    react.render(
      <RunHistory
        runs={[
          child,
          {
            ...base,
            tools: [{ toolCallId: 'tool', toolName: 'read_settings', status: 'completed' }]
          }
        ]}
      />
    );
    await react.user.click(
      screen.getByRole('button', { name: `${en.AgentRunQuiz} ${en.AgentActivityStepComplete}` })
    );
    expect(
      screen.queryByRole('button', { name: `${en.AgentRunPlan} ${en.AgentActivityStepComplete}` })
    ).not.toBeInTheDocument();
    const tool = screen.getByRole('button', {
      name: `${en.AssistantCallReadSettings} ${en.AssistantToolDone}`
    });

    await react.user.click(tool);
    const childButton = await screen.findByRole('button', {
      name: `${en.AgentRunPlan} ${en.AgentActivityStepComplete}`
    });

    expect(
      within(tool.parentElement!).getByRole('button', { name: childButton.textContent! })
    ).toBeVisible();
  }
);

test.unit.stable.extend('locale', 'italian')(
  'legacy and retained orphan runs stay inspectable with Italian labels',
  async ({ react, expect }) => {
    const { screen } = react;

    react.render(
      <RunHistory
        runs={[
          { ...base, trace: undefined, usage: undefined, text: 'Legacy draft', status: 'failed' },
          {
            ...base,
            runId: agentRunIdSchema.make('orphan'),
            trace: { ...base.trace!, parentRunId: agentRunIdSchema.make('expired') }
          }
        ]}
      />
    );
    expect(screen.getByRole('button', { name: 'Passaggio 1 Non riuscito' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Creazione del quiz Completato' })).toBeVisible();
    await react.user.click(screen.getByRole('button', { name: 'Creazione del quiz Completato' }));
    expect(screen.getAllByRole('button', { name: catalogs.italian.AgentRunDetails })).toHaveLength(
      2
    );
  }
);
