import { testStable } from '@study/testing/vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, vi } from 'vite-plus/test';

vi.mock('#client/lib/ai-readiness.ts', () => ({ useAiReadiness: () => 'ready' }));

import { api, mountAssistant as mount } from '#client/test/assistant.tsx';

testStable('sends only nonblank user messages and supports multiline drafts', async () => {
  const user = userEvent.setup();

  mount();
  const input = await screen.findByRole('textbox', { name: 'Message' });

  await waitFor(() => expect(input).toBeEnabled());
  const send = screen.getByRole('button', { name: 'Send message' });

  expect(send).toBeDisabled();
  await user.type(input, '   ');
  expect(send).toBeDisabled();
  await user.clear(input);
  await user.type(input, 'Explain this topic{Shift>}{Enter}{/Shift}with an example');
  expect(screen.queryAllByRole('article')).toHaveLength(0);
  await user.keyboard('{Enter}');
  await waitFor(() => expect(api.ask).toHaveBeenCalledOnce());
  expect(await screen.findByRole('article', { name: 'You' })).toHaveTextContent(
    'Explain this topic with an example'
  );
  await waitFor(() => expect(input).toHaveValue(''));
  expect(input).toHaveFocus();
  expect(screen.getByRole('article', { name: 'Assistant' })).toHaveAttribute(
    'data-role',
    'assistant'
  );
});
