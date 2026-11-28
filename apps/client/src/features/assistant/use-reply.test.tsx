import { agentProgressPageSchema } from '@study/contracts';
import { test } from '@study/testing';
import { Schema } from 'effect';

import type { AssistantHarness } from '#client/test/assistant.tsx';

const execution = {
  id: 'run',
  workflow: 'conversation-reply/v1',
  correlationId: 'reply',
  status: 'running',
  outcome: null,
  failureKind: null,
  configurationWaitReason: null,
  canCancel: true,
  createdAtMs: 1n,
  updatedAtMs: 1n
};

let api: AssistantHarness['api'];

let message: AssistantHarness['message'];

let mountAssistant: AssistantHarness['mountAssistant'];

test.unit.beforeEach(({ assistant, mock }) => {
  mock('#client/lib/ai-readiness.ts', () => ({ useAiReadiness: () => 'ready' }));
  api = assistant.api;
  message = assistant.message;
  mountAssistant = assistant.mountAssistant;
});

test.unit.stable(
  'renders streamed snapshots without duplicating text and stops the exact execution',
  async ({ waitFor, expect, act, screen, fireEvent }) => {
    api.thread.mockResolvedValue({
      items: [message('user', 'Explain.', 1n), message('assistant', '', 2n, true)],
      next: null
    });
    api.executions.mockResolvedValue({ items: [execution], next: null });
    api.cancel.mockResolvedValue(execution);
    const { notify } = await mountAssistant();

    await waitFor(() => expect(api.progress).toHaveBeenCalled());
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
          configurationWaitReason: null,
          text,
          tools: [],
          revision: 1n,
          updatedAtMs: 1n
        }
      ]);

    api.progress.mockResolvedValue(update('First **part**'));
    await act(async () => {
      await notify();
    });
    expect(await screen.findByText('part')).toBeInTheDocument();
    api.progress.mockResolvedValue(update('First **part**, then more.'));
    await act(async () => {
      await notify();
    });
    expect(screen.getByRole('article', { name: 'Assistant' })).toHaveTextContent(
      'First part, then more.'
    );
    fireEvent.click(screen.getByRole('button', { name: 'Stop reply' }));
    await waitFor(() => expect(api.cancel).toHaveBeenCalledWith({ id: 'run', mode: 'safe' }));
  }
);

test.unit.stable(
  'explains sign-in failures and retries the same Assistant message',
  async ({ expect, screen, fireEvent, waitFor }) => {
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
    await mountAssistant();
    expect(await screen.findByText(/Connect a provider under Settings/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Send again' }));
    await waitFor(() => expect(api.reanswer).toHaveBeenCalledWith({ messageId: 2n }));
  }
);
