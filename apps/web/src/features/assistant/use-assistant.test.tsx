import { askResultSchema } from '@study/contracts/conversations/schemas';
import { testStable } from '@study/testing/vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { Schema } from 'effect';
import { expect } from 'vite-plus/test';

import { api, message, mountAssistant } from '#web/test/assistant.tsx';

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
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    await waitFor(() => expect(api.ask).toHaveBeenCalledTimes(2));
    expect(api.ask.mock.calls[1][0]).toEqual(api.ask.mock.calls[0][0]);
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
          title: 'Earlier conversation',
          projectIds: [],
          titleSource: 'user',
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
    await waitFor(() => expect(api.session).toHaveBeenCalledWith({ id: 92n }));
    await waitFor(() => expect(input).toBeEnabled());
    expect(input).toHaveValue('');
    fireEvent.change(input, { target: { value: 'Draft for the new chat' } });
    fireEvent.click(screen.getByRole('button', { name: 'Earlier conversation' }));
    await waitFor(() => expect(input).toHaveValue('Draft for the earlier chat'));
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    await waitFor(() =>
      expect(api.ask).toHaveBeenCalledWith(
        expect.objectContaining({ sessionId: 91n, text: 'Draft for the earlier chat' })
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
    await waitFor(() => expect(api.session).toHaveBeenCalledWith({ id: 92n }));
    await waitFor(() => expect(input).toBeEnabled());
    fireEvent.change(input, { target: { value: 'Same text' } });
    await act(async () => {
      finish(
        Schema.decodeUnknownSync(askResultSchema)({
          sessionId: 91n,
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
