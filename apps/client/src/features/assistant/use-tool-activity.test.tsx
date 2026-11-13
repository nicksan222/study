import { agentProgressPageSchema } from '@study/contracts/ai/progress';
import { testStable } from '@study/testing/vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { Schema } from 'effect';
import { expect } from 'vite-plus/test';

import { api, message, mountAssistant } from '#client/test/assistant.tsx';

function progress(status: 'running' | 'completed' | 'failed' | 'cancelled' = 'completed') {
  return Schema.decodeUnknownSync(agentProgressPageSchema)([
    {
      runId: 'tools-run',
      executionId: 'execution',
      executionStatus:
        status === 'cancelled' ? 'cancelled' : status === 'running' ? 'running' : 'completed',
      agentId: 'assistant',
      mode: 'text',
      status,
      failureKind: status === 'failed' ? 'not_found' : null,
      text: 'Saved.',
      revision: 1n,
      updatedAtMs: 20n,
      tools: [
        {
          toolCallId: 'read-1',
          toolName: 'read_settings',
          status: status === 'failed' ? 'failed' : status,
          input: { text: '{}', truncated: false },
          output:
            status === 'completed'
              ? { text: '{"review":{"newCardsPerDay":12}}', truncated: false }
              : undefined,
          errorKind: status === 'failed' ? 'not_found' : undefined,
          startedAtMs: 1n,
          finishedAtMs: status === 'running' ? undefined : 20n
        }
      ]
    }
  ]);
}

function savedThread() {
  return {
    items: [message('user', 'Check settings.', 1n), message('assistant', 'Saved.', 2n)],
    next: null
  };
}

testStable(
  'saved calls expand with real inputs and results and reload with the exact reply version',
  async () => {
    api.thread.mockResolvedValue(savedThread());
    api.progress.mockResolvedValue(progress());
    const view = mountAssistant();
    const summary = await screen.findByRole('button', {
      name: /Actions (completed|failed|stopped)/
    });

    expect(summary).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(summary);
    const label = await screen.findByText('Read settings');
    const call = label.closest('[data-slot=trace-collapsible]')!;

    expect(call).not.toHaveAttribute('data-open');
    const trigger = screen.getByRole('button', { name: 'Read settings Completed' });

    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(call).toHaveAttribute('data-open');
    expect(screen.getByRole('region', { name: 'Input' })).toHaveTextContent('{}');
    expect(screen.getByRole('region', { name: 'Result' })).toHaveTextContent(
      '{"review":{"newCardsPerDay":12}}'
    );
    fireEvent.click(summary);
    expect(summary).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(summary);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(api.provenance).toHaveBeenCalledWith({ noteId: 91n, messageId: 2n, versionId: 2n });
    expect(api.progress).toHaveBeenCalledWith({ correlationId: 'reply' });
    view.unmount();
    mountAssistant();
    expect(await screen.findByText('Read settings')).toBeInTheDocument();
    expect(
      screen.getByText('Read settings').closest('[data-slot=trace-collapsible]')
    ).not.toHaveAttribute('data-open');
  }
);

testStable('open tool details stay open when streaming settles into the saved reply', async () => {
  api.thread.mockResolvedValue({
    items: [message('user', 'Check settings.', 1n), message('assistant', '', 2n, true)],
    next: null
  });
  api.progress.mockResolvedValue(progress('running'));
  const { client } = mountAssistant();

  await expandSavedActivity();
  const label = await screen.findByText('Read settings');

  fireEvent.click(label.closest('button')!);
  const disclosure = label.closest('[data-slot=trace-collapsible]');

  expect(disclosure).toHaveAttribute('data-open');
  api.progress.mockResolvedValue(progress());
  api.thread.mockResolvedValue(savedThread());
  await act(async () => {
    await client.invalidateQueries({ queryKey: ['assistant'] });
  });
  expect(await screen.findByText('Saved.')).toBeInTheDocument();
  await expandSavedActivity();
  expect(screen.getByText('Read settings').closest('[data-slot=trace-collapsible]')).toBe(
    disclosure
  );
  expect(disclosure).toHaveAttribute('data-open');
  expect(screen.getByRole('region', { name: 'Result' })).toHaveTextContent(
    '{"review":{"newCardsPerDay":12}}'
  );
});

testStable.each(['failed', 'cancelled'] as const)(
  'settles %s calls honestly without a fake result',
  async (status) => {
    api.thread.mockResolvedValue(savedThread());
    const snapshot = progress(status);

    // A terminal run can fence the final tool event, leaving its stored status running.
    api.progress.mockResolvedValue(
      snapshot.map((run) => ({
        ...run,
        tools: run.tools.map((tool) => ({ ...tool, status: 'running' }))
      }))
    );
    mountAssistant();
    await expandSavedActivity();
    const label = await screen.findByText('Read settings');

    expect(await screen.findByText(status === 'failed' ? 'Failed' : 'Stopped')).toBeInTheDocument();
    fireEvent.click(label.closest('button')!);
    expect(screen.queryByRole('region', { name: 'Result' })).not.toBeInTheDocument();
    expect(screen.getByText('No result was returned.')).toBeInTheDocument();
  }
);

testStable(
  'repeated calls stay separate, and large or unsafe result text stays a bounded preview',
  async () => {
    api.thread.mockResolvedValue(savedThread());
    const data = progress();
    const tool = data[0]!.tools[0]!;

    api.progress.mockResolvedValue(
      Schema.decodeUnknownSync(agentProgressPageSchema)([
        {
          ...data[0],
          tools: [
            tool,
            {
              ...tool,
              toolCallId: 'read-2',
              output: { text: '<script>window.bad=true</script>', truncated: true }
            }
          ]
        }
      ])
    );
    const { container } = mountAssistant();

    await expandSavedActivity();
    const rows = await screen.findAllByText('Read settings');

    expect(rows).toHaveLength(2);
    fireEvent.click(rows[1]!.closest('button')!);
    expect(rows[0]!.closest('[data-slot=trace-collapsible]')).not.toHaveAttribute('data-open');
    expect(
      within(rows[1]!.closest('[data-slot=trace-collapsible]')!).getByRole('region', {
        name: 'Result'
      })
    ).toHaveTextContent('<script>window.bad=true</script>');
    expect(container.querySelector('script')).toBeNull();
    expect(screen.getByText('Preview shortened for large content.')).toBeInTheDocument();
  }
);

testStable('polls again when the first pending snapshot has no calls yet', async () => {
  api.thread.mockResolvedValue({
    items: [message('user', 'Check settings.', 1n), message('assistant', '', 2n, true)],
    next: null
  });
  api.progress.mockResolvedValueOnce([]).mockResolvedValue(progress('running'));
  mountAssistant();
  expect(await screen.findByText('Read settings', {}, { timeout: 2500 })).toBeInTheDocument();
  expect(api.progress.mock.calls.length).toBeGreaterThanOrEqual(2);
});

testStable('legacy calls without stored details remain inspectable', async () => {
  api.thread.mockResolvedValue(savedThread());
  const data = progress();

  api.progress.mockResolvedValue(
    data.map((run) => ({
      ...run,
      tools: [{ toolCallId: 'legacy-1', toolName: 'retired_tool', status: 'completed' }]
    }))
  );
  mountAssistant();
  await expandSavedActivity();
  const label = await screen.findByText('Study action');

  fireEvent.click(label.closest('button')!);
  expect(screen.getByText('retired_tool')).toBeInTheDocument();
  expect(screen.queryByRole('region', { name: 'Input' })).not.toBeInTheDocument();
  expect(screen.queryByRole('region', { name: 'Result' })).not.toBeInTheDocument();
  expect(screen.getByText('Details were not recorded for this call.')).toBeInTheDocument();
});

testStable('failed activity requests offer a retry that loads the saved calls', async () => {
  api.thread.mockResolvedValue(savedThread());
  api.progress.mockRejectedValueOnce(new Error('Disconnected')).mockResolvedValue(progress());
  mountAssistant();
  fireEvent.click(await screen.findByRole('button', { name: 'Retry' }));
  expect(await screen.findByText('Read settings')).toBeInTheDocument();
  await waitFor(() =>
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument()
  );
});

async function expandSavedActivity() {
  const summary = await screen.findByRole('button', {
    name: /(?:Actions (?:completed|failed|stopped)|Working) ·/
  });

  if (summary.getAttribute('aria-expanded') === 'false') fireEvent.click(summary);
}
