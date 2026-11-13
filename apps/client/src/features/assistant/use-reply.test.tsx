import { agentProgressPageSchema } from '@study/contracts/ai/progress';
import { testStable } from '@study/testing/vitest';
import { QueryObserver } from '@tanstack/react-query';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { Schema } from 'effect';
import { expect, vi } from 'vite-plus/test';

import { api, message, mountAssistant } from '#client/test/assistant.tsx';

vi.mock('#client/lib/ai-readiness.ts', () => ({ useAiReadiness: () => 'ready' }));

const execution = {
  id: 'run',
  workflow: 'conversation-reply/v1',
  correlationId: 'reply',
  status: 'running',
  outcome: null,
  failureKind: null,
  canCancel: true,
  createdAtMs: 1n,
  updatedAtMs: 1n
};

testStable(
  'renders streamed snapshots without duplicating text and stops the exact execution',
  async () => {
    let receive!: (value: typeof agentProgressPageSchema.Type) => void;

    api.thread.mockResolvedValue({
      items: [message('user', 'Explain.', 1n), message('assistant', '', 2n, true)],
      next: null
    });
    api.executions.mockResolvedValue({ items: [execution], next: null });
    api.cancel.mockResolvedValue(execution);
    api.subscribe.mockImplementation((_invoke, onValue) => {
      receive = onValue;

      return new Promise(() => {});
    });
    mountAssistant();
    await waitFor(() => expect(receive).toBeTypeOf('function'));
    const update = (text: string) =>
      Schema.decodeUnknownSync(agentProgressPageSchema)([
        {
          runId: 'r',
          executionId: 'run',
          executionStatus: 'running',
          agentId: 'assistant',
          mode: 'text',
          status: 'running',
          failureKind: null,
          text,
          tools: [],
          revision: 1n,
          updatedAtMs: 1n
        }
      ]);

    act(() => receive(update('First **part**')));
    expect(await screen.findByText('part')).toBeInTheDocument();
    act(() => receive(update('First **part**, then more.')));
    expect(screen.getByRole('article', { name: 'Assistant' })).toHaveTextContent(
      'First part, then more.'
    );
    fireEvent.click(screen.getByRole('button', { name: 'Stop reply' }));
    await waitFor(() => expect(api.cancel).toHaveBeenCalledWith({ id: 'run', mode: 'safe' }));
  }
);

testStable('explains sign-in failures and retries the same Assistant message', async () => {
  api.thread.mockResolvedValue({
    items: [message('user', 'Explain.', 1n), message('assistant', '', 2n, true)],
    next: null
  });
  api.executions.mockResolvedValue({
    items: [
      {
        ...execution,
        status: 'completed',
        outcome: 'failure',
        failureKind: 'auth',
        canCancel: false
      }
    ],
    next: null
  });
  api.reanswer.mockResolvedValue({
    requestId: 'retry',
    noteId: 91n,
    messageId: 2n,
    versionId: 3n
  });
  mountAssistant();
  expect(await screen.findByText(/Connect a provider under Settings/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  await waitFor(() => expect(api.reanswer).toHaveBeenCalledWith({ messageId: 2n }));
});

testStable(
  'stream failures do not render per-message connection errors or reconnect controls',
  async () => {
    api.thread.mockResolvedValue({
      items: [message('user', 'Explain.', 1n), message('assistant', '', 2n, true)],
      next: null
    });
    api.executions.mockResolvedValue({ items: [execution], next: null });
    api.subscribe.mockRejectedValueOnce(new Error('Stream unavailable'));
    mountAssistant();
    await waitFor(() => expect(api.subscribe).toHaveBeenCalledOnce());
    expect(screen.queryByText(/Live progress is unavailable/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Reconnecting to live progress/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Refresh' })).not.toBeInTheDocument();
  }
);

testStable(
  'completed note tools refresh content without resetting open tabs or drafts',
  async () => {
    let receive!: (value: typeof agentProgressPageSchema.Type) => void;

    api.thread.mockResolvedValue({
      items: [message('user', 'Explain.', 1n), message('assistant', '', 2n, true)],
      next: null
    });
    api.executions.mockResolvedValue({ items: [execution], next: null });
    api.subscribe.mockImplementation((_invoke, onValue) => {
      receive = onValue;

      return new Promise(() => {});
    });
    const { client } = mountAssistant();
    const workbench = { tabs: ['assistant'], draft: 'Keep this question' };
    const resetWorkbench = vi.fn(async () => ({ tabs: [], draft: '' }));
    const refreshContent = vi.fn(async () => 'updated');
    const tabs = new QueryObserver(client, {
      queryKey: ['note-drafts', '25', 'workbench'],
      queryFn: resetWorkbench,
      initialData: workbench,
      staleTime: Infinity
    });
    const content = new QueryObserver(client, {
      queryKey: ['materials'],
      queryFn: refreshContent,
      initialData: 'original',
      staleTime: Infinity
    });
    const stopTabs = tabs.subscribe(() => {});
    const stopContent = content.subscribe(() => {});

    try {
      await waitFor(() => expect(receive).toBeTypeOf('function'));
      act(() =>
        receive(
          Schema.decodeUnknownSync(agentProgressPageSchema)([
            {
              runId: 'scoped',
              executionId: 'run',
              executionStatus: 'running',
              agentId: 'note-assistant',
              mode: 'text',
              status: 'running',
              failureKind: null,
              text: '',
              tools: [{ toolCallId: 'edit', toolName: 'edit_note_message', status: 'completed' }],
              revision: 1n,
              updatedAtMs: 1n
            }
          ])
        )
      );
      await waitFor(() => expect(refreshContent).toHaveBeenCalledOnce());
      expect(resetWorkbench).not.toHaveBeenCalled();
      expect(tabs.getCurrentResult().data).toEqual(workbench);
    } finally {
      stopTabs();
      stopContent();
    }
  }
);
