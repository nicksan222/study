import { askResultSchema } from '@study/contracts';
import { test } from '@study/testing';
import { Schema } from 'effect';

import type { AssistantHarness } from '#client/test/assistant.tsx';

const readiness = { state: 'ready' };

let api: AssistantHarness['api'];

let message: AssistantHarness['message'];

let mountAssistant: AssistantHarness['mountAssistant'];

test.beforeEach(({ assistant, mock }) => {
  readiness.state = 'ready';
  mock('#client/lib/ai-readiness-notice.tsx', () => ({ AiReadinessNotice: () => null }));
  mock('#client/lib/ai-readiness.ts', () => ({ useAiReadiness: () => readiness.state }));
  api = assistant.api;
  message = assistant.message;
  mountAssistant = assistant.mountAssistant;
});

test.stable(
  'reuses the same intent after an uncertain send failure and preserves the draft',
  async () => {
    api.ask.mockRejectedValueOnce(new Error('Connection lost'));
    await mountAssistant();
    const input = await test.screen.findByRole('textbox', { name: 'Message' });

    await test.waitFor(() => test.expect(input).toBeEnabled());
    test.fireEvent.change(input, { target: { value: 'Keep this request' } });
    test.fireEvent.click(test.screen.getByRole('button', { name: 'Send message' }));
    await test.screen.findByText(/Could not load or send/);
    test.expect(input).toHaveValue('Keep this request');
    test.fireEvent.click(test.screen.getByRole('button', { name: 'Retry' }));
    await test.waitFor(() =>
      test.expect(test.screen.queryByText(/Could not load or send/)).not.toBeInTheDocument()
    );
    test.expect(input).toHaveValue('Keep this request');
    test.fireEvent.click(test.screen.getByRole('button', { name: 'Send message' }));
    await test.waitFor(() => test.expect(api.ask).toHaveBeenCalledTimes(2));
    test.expect(api.ask.mock.calls[1][0]).toEqual(api.ask.mock.calls[0][0]);
  }
);

test.stable(
  'editing the next draft cannot detach an in-flight send or allow a second send',
  async () => {
    api.ask.mockImplementation(() => new Promise(() => {}));
    await mountAssistant();
    const input = await test.screen.findByRole('textbox', { name: 'Message' });

    await test.waitFor(() => test.expect(input).toBeEnabled());
    test.fireEvent.change(input, { target: { value: 'First request' } });
    test.fireEvent.click(test.screen.getByRole('button', { name: 'Send message' }));
    await test.waitFor(() => test.expect(api.ask).toHaveBeenCalledTimes(1));
    test.fireEvent.change(input, { target: { value: 'Next draft' } });
    test.expect(test.screen.getByRole('button', { name: 'Send message' })).toBeDisabled();
    test.fireEvent.keyDown(input, { key: 'Enter' });
    test.expect(api.ask).toHaveBeenCalledTimes(1);
    test.expect(input).toHaveValue('Next draft');
  }
);

test.stable('renders saved user and Assistant messages separately with safe Markdown', async () => {
  api.thread.mockResolvedValue({
    items: [
      message('user', 'Explain gravity.', 1n),
      message('assistant', '**Gravity** attracts mass.', 2n)
    ],
    next: null
  });
  await mountAssistant();
  const user = await test.screen.findByRole('article', { name: 'You' });
  const assistant = await test.screen.findByRole('article', { name: 'Assistant' });

  test.expect(user).toHaveAttribute('data-role', 'user');
  test.expect(assistant).toHaveAttribute('data-role', 'assistant');
  test.expect(assistant.querySelector('strong')).toHaveTextContent('Gravity');
});

test.stable(
  'creates a separate chat and restores the earlier chat draft from the history card',
  async () => {
    api.chats.mockResolvedValue({
      items: [
        {
          id: 91n,
          title: 'Earlier note',
          projectIds: [],
          titleSource: 'user',
          archivedAt: null,
          createdAt: 1n,
          updatedAt: 1n
        }
      ],
      next: null
    });
    await mountAssistant();
    const input = await test.screen.findByRole('textbox', { name: 'Message' });

    await test.waitFor(() => test.expect(input).toBeEnabled());
    test.fireEvent.change(input, { target: { value: 'Draft for the earlier chat' } });
    test.fireEvent.click(test.screen.getByRole('button', { name: 'Chat history' }));
    test.fireEvent.click(test.screen.getByRole('button', { name: 'New chat' }));
    await test.waitFor(() => test.expect(api.newChat).toHaveBeenCalledTimes(1));
    await test.waitFor(() => test.expect(api.note).toHaveBeenCalledWith({ id: 92n }));
    await test.waitFor(() => test.expect(input).toBeEnabled());
    test.expect(input).toHaveValue('');
    test.fireEvent.change(input, { target: { value: 'Draft for the new chat' } });
    test.fireEvent.click(test.screen.getByRole('button', { name: 'Earlier note' }));
    await test.waitFor(() => test.expect(input).toHaveValue('Draft for the earlier chat'));
    const send = test.screen.getByRole('button', { name: 'Send message' });

    await test.waitFor(() => test.expect(send).toBeEnabled());
    test.fireEvent.click(send);
    await test.waitFor(() =>
      test
        .expect(api.ask)
        .toHaveBeenCalledWith(
          test.expect.objectContaining({ noteId: 91n, text: 'Draft for the earlier chat' })
        )
    );
  }
);

test.stable('shows an estimated context ring that includes the unsent draft', async () => {
  await mountAssistant();
  const meter = await test.screen.findByRole('meter');

  test.expect(meter).toHaveAttribute('aria-valuenow', '16');
  test.fireEvent.change(test.screen.getByRole('textbox', { name: 'Message' }), {
    target: { value: 'a'.repeat(4000) }
  });
  test.expect(meter).toHaveAttribute('aria-valuenow', '18');
  test.expect(meter).toHaveAccessibleName(/Auto compact is on/);
});

test.stable('an idle chat does not keep polling its history and context', async () => {
  await mountAssistant();
  await test.screen.findByRole('meter');
  await test.waitFor(() => test.expect(api.thread).toHaveBeenCalled());
  const threadCalls = api.thread.mock.calls.length;
  const contextCalls = api.context.mock.calls.length;

  test.vi.useFakeTimers();

  try {
    await test.act(async () => {
      await test.vi.advanceTimersByTimeAsync(3500);
    });
    test.expect(api.thread).toHaveBeenCalledTimes(threadCalls);
    test.expect(api.context).toHaveBeenCalledTimes(contextCalls);
  } finally {
    test.vi.useRealTimers();
  }
});

test.stable(
  'a delayed send only clears its original chat draft after creating another chat',
  async () => {
    let finish!: (value: Awaited<ReturnType<typeof api.ask>>) => void;

    api.ask.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    await mountAssistant();
    const input = await test.screen.findByRole('textbox', { name: 'Message' });

    await test.waitFor(() => test.expect(input).toBeEnabled());
    test.fireEvent.change(input, { target: { value: 'Same text' } });
    test.fireEvent.click(test.screen.getByRole('button', { name: 'Send message' }));
    await test.waitFor(() => test.expect(api.ask).toHaveBeenCalledTimes(1));
    test.fireEvent.click(test.screen.getByRole('button', { name: 'Chat history' }));
    test.fireEvent.click(test.screen.getByRole('button', { name: 'New chat' }));
    await test.waitFor(() => test.expect(api.note).toHaveBeenCalledWith({ id: 92n }));
    await test.waitFor(() => test.expect(input).toBeEnabled());
    test.fireEvent.change(input, { target: { value: 'Same text' } });
    await test.act(async () => {
      finish(
        Schema.decodeUnknownSync(askResultSchema)({
          noteId: 91n,
          messageId: 2n,
          versionId: 2n,
          requestId: 'finished',
          userMessageId: 1n,
          userVersionId: 1n
        })
      );
    });
    await test.waitFor(() => test.expect(input).toHaveValue('Same text'));
  }
);

test.stable('blocks new sends while setup is needed and keeps the draft editable', async () => {
  readiness.state = 'setup';

  try {
    await mountAssistant();
    const input = await test.screen.findByRole('textbox', { name: 'Message' });

    await test.waitFor(() => test.expect(input).toBeEnabled());
    test.fireEvent.change(input, { target: { value: 'Keep this draft' } });
    test.expect(test.screen.getByRole('button', { name: 'Send message' })).toBeDisabled();
    test.fireEvent.keyDown(input, { key: 'Enter' });
    test.expect(api.ask).not.toHaveBeenCalled();
    test.expect(input).toHaveValue('Keep this draft');
  } finally {
    readiness.state = 'ready';
  }
});

test.stable(
  'server snapshots refresh committed content while the local question draft survives',
  async () => {
    const { notify } = await mountAssistant();
    const input = await test.screen.findByRole('textbox', { name: 'Message' });

    await test.waitFor(() => test.expect(input).toBeEnabled());
    test.fireEvent.change(input, { target: { value: 'Keep this question' } });
    api.thread.mockResolvedValue({
      items: [message('assistant', 'Updated from another window.', 2n)],
      next: null
    });
    await test.act(async () => {
      await notify();
    });
    test.expect(await test.screen.findByText('Updated from another window.')).toBeInTheDocument();
    test.expect(input).toHaveValue('Keep this question');
  }
);
