import { executionIdSchema, StudyError } from '@study/contracts';
import type { executionSchema } from '@study/contracts';
import { catalogs } from '@study/localization';
import { test } from '@study/testing';

import { AiActivitySettings } from './index';

type Execution = typeof executionSchema.Type;

function execution(id: string, workflow: string, state: Partial<Execution> = {}): Execution {
  return {
    id: executionIdSchema.make(id),
    workflow,
    status: 'completed',
    outcome: 'success',
    failureKind: null,
    correlationId: null,
    configurationWaitReason: null,
    canCancel: false,
    createdAtMs: 1_800_000_000_000n,
    updatedAtMs: 1_800_000_001_000n,
    ...state
  };
}

test.unit.stable(
  'opens terminal run details and retains the selected run across live history changes',
  async ({ rpc, react, mock, within, expect }) => {
    const { user, screen } = react;
    const saved = execution('private-run-id', 'material-generation/v1');
    const items = [
      saved,
      execution('cancelled-id', 'conversation-reply/v1', { status: 'cancelled', outcome: null }),
      execution('failed-id', 'quiz-grading/v1', { outcome: 'failure', failureKind: 'not_enough' })
    ];
    const selected = mock.fn(() => []);

    rpc.given({ 'workflows.executions': { items, next: null } });
    rpc.handle({ 'workflows.agentProgress': selected });
    react.render(<AiActivitySettings />);
    const savedRow = await screen.findByRole('button', { name: 'Create study material' });

    expect(within(savedRow).getByText(/Completed/)).toBeVisible();
    expect(
      within(screen.getByRole('button', { name: 'Generate reply' })).getByText(/Cancelled/)
    ).toBeVisible();
    expect(
      within(screen.getByRole('button', { name: 'Review answer' })).getByText(/Failed/)
    ).toBeVisible();
    expect(screen.queryByText(saved.id)).not.toBeInTheDocument();
    await user.click(savedRow);
    expect(
      await screen.findByRole('dialog', { name: catalogs.english.AgentActivityDetails })
    ).toBeVisible();
    expect(selected).toHaveBeenCalledWith({ executionId: saved.id });
    await rpc.update({ 'workflows.executions': { items: [], next: null } });
    expect(
      screen.getByRole('dialog', { name: catalogs.english.AgentActivityDetails })
    ).toBeVisible();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByText(catalogs.english.AiActivityEmpty)).toBeVisible();
  }
);

test.unit.stable(
  'paginates older runs with fixed bounded reads and restores the newest page',
  async ({ rpc, react, expect }) => {
    const { user, screen } = react;
    const newest = execution('newest', 'material-generation/v1');
    const older = execution('older', 'source-ingestion/v1');
    const cursor = { id: newest.id, createdAtMs: newest.createdAtMs };
    const inputs: unknown[] = [];

    rpc.handle({
      'workflows.executions': (input) => {
        inputs.push(input);

        return input.before ? { items: [older], next: null } : { items: [newest], next: cursor };
      }
    });

    react.render(<AiActivitySettings />);
    await user.click(await screen.findByRole('button', { name: catalogs.english.AiActivityOlder }));
    expect(await screen.findByRole('button', { name: 'Import material' })).toBeVisible();
    expect(inputs).toContainEqual({ limit: 30, before: cursor });
    await user.click(screen.getByRole('button', { name: catalogs.english.AiActivityRecent }));
    expect(await screen.findByRole('button', { name: 'Create study material' })).toBeVisible();
    expect(
      screen.queryByRole('button', { name: catalogs.english.AiActivityRecent })
    ).not.toBeInTheDocument();
  }
);

test.unit.stable.extend('locale', 'italian')(
  'shows localized loading, recovers a failed read and explains an empty history',
  async ({ rpc, react, expect }) => {
    const { user, screen } = react;
    const ready = Promise.withResolvers<void>();
    let failed = true;

    rpc.handle({
      'workflows.executions': async () => {
        await ready.promise;

        if (failed) throw new StudyError('transient', 'offline');

        return { items: [], next: null };
      }
    });

    react.render(<AiActivitySettings />);
    expect(screen.getByText(catalogs.italian.AiActivityLoading)).toBeVisible();
    ready.resolve();
    expect(await screen.findByText(catalogs.italian.AiActivityError)).toBeVisible();
    failed = false;
    await user.click(screen.getByRole('button', { name: catalogs.italian.Retry }));
    expect(await screen.findByText(catalogs.italian.AiActivityEmpty)).toBeVisible();
  }
);
