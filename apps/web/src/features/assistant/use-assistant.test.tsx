import { askResultSchema } from '@study/contracts/notes/schemas';
import { testStable } from '@study/testing/vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { Schema } from 'effect';
import { expect, vi } from 'vite-plus/test';

import { api, message, mountAssistant } from '#web/test/assistant.tsx';

const readiness = vi.hoisted(() => ({ state: 'ready' }));

vi.mock('#web/lib/ai-readiness-notice.tsx', () => ({ AiReadinessNotice: () => null }));
vi.mock('#web/lib/ai-readiness.ts', () => ({ useAiReadiness: () => readiness.state }));

testStable(
  'reuses the same intent after an uncertain send failure and preserves the draft',
  async () => {
    api.ask.mockRejectedValueOnce(new Error('Connection lost'));
    mountAssistant();
    const input = await screen.findByRole('textbox', { name: 'Message' });

    await waitFor(() => expect(input).toBeEnabled());
    fireEvent.change(input, { target: { value: 'Keep this request' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    await screen.findByText(/Could not load or send/);
    expect(input).toHaveValue('Keep this request');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() =>
      expect(screen.queryByText(/Could not load or send/)).not.toBeInTheDocument()
    );
    expect(input).toHaveValue('Keep this request');
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    await waitFor(() => expect(api.ask).toHaveBeenCalledTimes(2));
    expect(api.ask.mock.calls[1][0]).toEqual(api.ask.mock.calls[0][0]);
  }
);

testStable(
  'editing the next draft cannot detach an in-flight send or allow a second send',
  async () => {
    api.ask.mockImplementation(() => new Promise(() => {}));
    mountAssistant();
    const input = await screen.findByRole('textbox', { name: 'Message' });

    await waitFor(() => expect(input).toBeEnabled());
    fireEvent.change(input, { target: { value: 'First request' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    await waitFor(() => expect(api.ask).toHaveBeenCalledTimes(1));
    fireEvent.change(input, { target: { value: 'Next draft' } });
    expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled();
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(api.ask).toHaveBeenCalledTimes(1);
    expect(input).toHaveValue('Next draft');
  }
);

testStable('renders saved user and Assistant messages separately with safe Markdown', async () => {
  api.thread.mockResolvedValue({
    items: [
      message('user', 'Explain gravity.', 1n),
      message('assistant', '**Gravity** attracts mass.', 2n)
    ],
    next: null
  });
  mountAssistant();
  const user = await screen.findByRole('article', { name: 'You' });
  const assistant = await screen.findByRole('article', { name: 'Assistant' });

  expect(user).toHaveAttribute('data-role', 'user');
  expect(assistant).toHaveAttribute('data-role', 'assistant');
  expect(assistant.querySelector('strong')).toHaveTextContent('Gravity');
});

testStable(
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
    mountAssistant();
    const input = await screen.findByRole('textbox', { name: 'Message' });

    await waitFor(() => expect(input).toBeEnabled());
    fireEvent.change(input, { target: { value: 'Draft for the earlier chat' } });
    fireEvent.click(screen.getByRole('button', { name: 'Chat history' }));
    fireEvent.click(screen.getByRole('button', { name: 'New chat' }));
    await waitFor(() => expect(api.newChat).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(api.note).toHaveBeenCalledWith({ id: 92n }));
    await waitFor(() => expect(input).toBeEnabled());
    expect(input).toHaveValue('');
    fireEvent.change(input, { target: { value: 'Draft for the new chat' } });
    fireEvent.click(screen.getByRole('button', { name: 'Earlier note' }));
    await waitFor(() => expect(input).toHaveValue('Draft for the earlier chat'));
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    await waitFor(() =>
      expect(api.ask).toHaveBeenCalledWith(
        expect.objectContaining({ noteId: 91n, text: 'Draft for the earlier chat' })
      )
    );
  }
);

testStable('shows an estimated context ring that includes the unsent draft', async () => {
  mountAssistant();
  const meter = await screen.findByRole('meter');

  expect(meter).toHaveAttribute('aria-valuenow', '16');
  fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), {
    target: { value: 'a'.repeat(4000) }
  });
  expect(meter).toHaveAttribute('aria-valuenow', '18');
  expect(meter).toHaveAccessibleName(/Auto compact is on/);
});

testStable('an idle chat does not keep polling its history and context', async () => {
  mountAssistant();
  await screen.findByRole('meter');
  await waitFor(() => expect(api.thread).toHaveBeenCalled());
  const threadCalls = api.thread.mock.calls.length;
  const contextCalls = api.context.mock.calls.length;

  vi.useFakeTimers();

  try {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3500);
    });
    expect(api.thread).toHaveBeenCalledTimes(threadCalls);
    expect(api.context).toHaveBeenCalledTimes(contextCalls);
  } finally {
    vi.useRealTimers();
  }
});

testStable(
  'a delayed send only clears its original chat draft after creating another chat',
  async () => {
    let finish!: (value: Awaited<ReturnType<typeof api.ask>>) => void;

    api.ask.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    mountAssistant();
    const input = await screen.findByRole('textbox', { name: 'Message' });

    await waitFor(() => expect(input).toBeEnabled());
    fireEvent.change(input, { target: { value: 'Same text' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    await waitFor(() => expect(api.ask).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: 'Chat history' }));
    fireEvent.click(screen.getByRole('button', { name: 'New chat' }));
    await waitFor(() => expect(api.note).toHaveBeenCalledWith({ id: 92n }));
    await waitFor(() => expect(input).toBeEnabled());
    fireEvent.change(input, { target: { value: 'Same text' } });
    await act(async () => {
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
    await waitFor(() => expect(input).toHaveValue('Same text'));
  }
);

testStable('blocks new sends while setup is needed and keeps the draft editable', async () => {
  readiness.state = 'setup';

  try {
    mountAssistant();
    const input = await screen.findByRole('textbox', { name: 'Message' });

    await waitFor(() => expect(input).toBeEnabled());
    fireEvent.change(input, { target: { value: 'Keep this draft' } });
    expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled();
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(api.ask).not.toHaveBeenCalled();
    expect(input).toHaveValue('Keep this draft');
  } finally {
    readiness.state = 'ready';
  }
});
