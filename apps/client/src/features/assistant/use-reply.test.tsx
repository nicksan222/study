import { agentProgressPageSchema } from '@study/contracts';
import { test } from '@study/testing';
import { Schema } from 'effect';

import { api, message, mountAssistant } from '#client/test/assistant.tsx';

test.mock('#client/lib/ai-readiness.ts', () => ({ useAiReadiness: () => 'ready' }));

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

test.stable(
  'renders streamed snapshots without duplicating text and stops the exact execution',
  async () => {
    api.thread.mockResolvedValue({
      items: [message('user', 'Explain.', 1n), message('assistant', '', 2n, true)],
      next: null
    });
    api.executions.mockResolvedValue({ items: [execution], next: null });
    api.cancel.mockResolvedValue(execution);
    const { notify } = mountAssistant();

    await test.waitFor(() => test.expect(api.progress).toHaveBeenCalled());
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
    await test.act(async () => {
      await notify();
    });
    test.expect(await test.screen.findByText('part')).toBeInTheDocument();
    api.progress.mockResolvedValue(update('First **part**, then more.'));
    await test.act(async () => {
      await notify();
    });
    test
      .expect(test.screen.getByRole('article', { name: 'Assistant' }))
      .toHaveTextContent('First part, then more.');
    test.fireEvent.click(test.screen.getByRole('button', { name: 'Stop reply' }));
    await test.waitFor(() =>
      test.expect(api.cancel).toHaveBeenCalledWith({ id: 'run', mode: 'safe' })
    );
  }
);

test.stable('explains sign-in failures and retries the same Assistant message', async () => {
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
  test
    .expect(await test.screen.findByText(/Connect a provider under Settings/))
    .toBeInTheDocument();
  test.fireEvent.click(test.screen.getByRole('button', { name: 'Retry' }));
  await test.waitFor(() => test.expect(api.reanswer).toHaveBeenCalledWith({ messageId: 2n }));
});
