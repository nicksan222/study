import { testStable } from '@study/testing/vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
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
