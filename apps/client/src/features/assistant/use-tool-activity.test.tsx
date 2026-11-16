import { agentProgressPageSchema } from '@study/contracts';
import { test } from '@study/testing';
import { Schema } from 'effect';

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

test.stable(
  'saved calls expand with real inputs and results and reload with the exact reply version',
  async () => {
    api.thread.mockResolvedValue(savedThread());
    api.progress.mockResolvedValue(progress());
    const view = mountAssistant();
    const summary = await test.screen.findByRole('button', {
      name: /Actions (completed|failed|stopped)/
    });

    test.expect(summary).toHaveAttribute('aria-expanded', 'false');
    test.fireEvent.click(summary);
    const label = await test.screen.findByText('Read settings');
    const call = label.closest('[data-slot=trace-collapsible]')!;

    test.expect(call).not.toHaveAttribute('data-open');
    const trigger = test.screen.getByRole('button', { name: 'Read settings Completed' });

    test.expect(trigger).toHaveAttribute('aria-expanded', 'false');
    test.fireEvent.click(trigger);
    test.expect(trigger).toHaveAttribute('aria-expanded', 'true');
    test.expect(call).toHaveAttribute('data-open');
    test.expect(test.screen.getByRole('region', { name: 'Input' })).toHaveTextContent('{}');
    test
      .expect(test.screen.getByRole('region', { name: 'Result' }))
      .toHaveTextContent('{"review":{"newCardsPerDay":12}}');
    test.fireEvent.click(summary);
    test.expect(summary).toHaveAttribute('aria-expanded', 'false');
    test.fireEvent.click(summary);
    test.expect(trigger).toHaveAttribute('aria-expanded', 'true');
    test.expect(api.provenance).toHaveBeenCalledWith({ noteId: 91n, messageId: 2n, versionId: 2n });
    test.expect(api.progress).toHaveBeenCalledWith({ correlationId: 'reply' });
    view.unmount();
    mountAssistant();
    test.expect(await test.screen.findByText('Read settings')).toBeInTheDocument();
    test
      .expect(test.screen.getByText('Read settings').closest('[data-slot=trace-collapsible]'))
      .not.toHaveAttribute('data-open');
  }
);

test.stable('open tool details stay open when streaming settles into the saved reply', async () => {
  api.thread.mockResolvedValue({
    items: [message('user', 'Check settings.', 1n), message('assistant', '', 2n, true)],
    next: null
  });
  api.progress.mockResolvedValue(progress('running'));
  const { notify } = mountAssistant();

  await expandSavedActivity();
  const label = await test.screen.findByText('Read settings');

  test.fireEvent.click(label.closest('button')!);
  const disclosure = label.closest('[data-slot=trace-collapsible]');

  test.expect(disclosure).toHaveAttribute('data-open');
  api.progress.mockResolvedValue(progress());
  api.thread.mockResolvedValue(savedThread());
  await test.act(async () => {
    await notify();
  });
  test.expect(await test.screen.findByText('Saved.')).toBeInTheDocument();
  await expandSavedActivity();
  test
    .expect(test.screen.getByText('Read settings').closest('[data-slot=trace-collapsible]'))
    .toBe(disclosure);
  test.expect(disclosure).toHaveAttribute('data-open');
  test
    .expect(test.screen.getByRole('region', { name: 'Result' }))
    .toHaveTextContent('{"review":{"newCardsPerDay":12}}');
});

test.stable.each(['failed', 'cancelled'] as const)(
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
    const label = await test.screen.findByText('Read settings');

    test
      .expect(await test.screen.findByText(status === 'failed' ? 'Failed' : 'Stopped'))
      .toBeInTheDocument();
    test.fireEvent.click(label.closest('button')!);
    test.expect(test.screen.queryByRole('region', { name: 'Result' })).not.toBeInTheDocument();
    test.expect(test.screen.getByText('No result was returned.')).toBeInTheDocument();
  }
);

test.stable(
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
    const rows = await test.screen.findAllByText('Read settings');

    test.expect(rows).toHaveLength(2);
    test.fireEvent.click(rows[1]!.closest('button')!);
    test.expect(rows[0]!.closest('[data-slot=trace-collapsible]')).not.toHaveAttribute('data-open');
    test
      .expect(
        test.within(rows[1]!.closest('[data-slot=trace-collapsible]')!).getByRole('region', {
          name: 'Result'
        })
      )
      .toHaveTextContent('<script>window.bad=true</script>');
    test.expect(container.querySelector('script')).toBeNull();
    test.expect(test.screen.getByText('Preview shortened for large content.')).toBeInTheDocument();
  }
);

test.stable('receives later tool activity after an initially empty live snapshot', async () => {
  api.thread.mockResolvedValue({
    items: [message('user', 'Check settings.', 1n), message('assistant', '', 2n, true)],
    next: null
  });
  api.progress.mockResolvedValue([]);
  const { notify } = mountAssistant();

  await test.waitFor(() => test.expect(api.progress).toHaveBeenCalled());
  api.progress.mockResolvedValue(progress('running'));
  await test.act(async () => {
    await notify();
  });
  test.expect(await test.screen.findByText('Read settings')).toBeInTheDocument();
});

test.stable('legacy calls without stored details remain inspectable', async () => {
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
  const label = await test.screen.findByText('Study action');

  test.fireEvent.click(label.closest('button')!);
  test.expect(test.screen.getByText('retired_tool')).toBeInTheDocument();
  test.expect(test.screen.queryByRole('region', { name: 'Input' })).not.toBeInTheDocument();
  test.expect(test.screen.queryByRole('region', { name: 'Result' })).not.toBeInTheDocument();
  test
    .expect(test.screen.getByText('Details were not recorded for this call.'))
    .toBeInTheDocument();
});

test.stable('failed activity requests offer a retry that loads the saved calls', async () => {
  api.thread.mockResolvedValue(savedThread());
  api.progress.mockRejectedValueOnce(new Error('Disconnected')).mockResolvedValue(progress());
  mountAssistant();
  test.fireEvent.click(await test.screen.findByRole('button', { name: 'Retry' }));
  test.expect(await test.screen.findByText('Read settings')).toBeInTheDocument();
  await test.waitFor(() =>
    test.expect(test.screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument()
  );
});

async function expandSavedActivity() {
  const summary = await test.screen.findByRole('button', {
    name: /(?:Actions (?:completed|failed|stopped)|Working) ·/
  });

  if (summary.getAttribute('aria-expanded') === 'false') test.fireEvent.click(summary);
}
