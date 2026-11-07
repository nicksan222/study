import { testStable } from '@study/testing/vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { expect } from 'vite-plus/test';

import { mountAssistant as mount } from '#web/test/assistant.tsx';

testStable('does not send during input-method composition or dismiss on Escape', async () => {
  mount();
  const input = await screen.findByRole('textbox', { name: 'Message' });

  await waitFor(() => expect(input).toBeEnabled());

  fireEvent.change(input, { target: { value: '日本語' } });
  fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
  expect(screen.queryAllByRole('article')).toHaveLength(0);
  expect(input).toHaveValue('日本語');
  fireEvent.keyDown(input, { key: 'Escape' });
  expect(screen.getByRole('heading', { name: 'Assistant' })).toBeInTheDocument();
});
