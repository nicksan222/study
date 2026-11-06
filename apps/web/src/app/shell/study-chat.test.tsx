import { testStable } from '@study/testing/vitest';
import { ChatDrawerTrigger, createChatDrawerHandle } from '@study/ui/chat-drawer';
import { Sidebar } from '@study/ui/sidebar';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect } from 'vite-plus/test';

import { StudyChat } from './study-chat';

function ChatHarness() {
  const handle = createChatDrawerHandle();

  return (
    <>
      <Sidebar.Navigation aria-label="Study navigation">
        <ChatDrawerTrigger handle={handle} label="Study chat" />
      </Sidebar.Navigation>
      <StudyChat handle={handle} />
    </>
  );
}

testStable('makes the background inaccessible while the chat drawer is open', async () => {
  const user = userEvent.setup();

  render(
    <>
      <button type="button">Page action</button>
      <ChatHarness />
    </>
  );
  await user.click(screen.getByRole('button', { name: 'Study chat' }));
  await screen.findByRole('dialog', { name: 'Study chat' });
  expect(screen.queryByRole('button', { name: 'Page action' })).toBeNull();
  expect(screen.getByRole('dialog', { name: 'Study chat' })).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Close' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Page action' })).toBeVisible());
});

testStable(
  'adds only user messages and keeps the conversation and draft when reopened',
  async () => {
    const user = userEvent.setup();

    render(<ChatHarness />);
    const trigger = screen.getByRole('button', { name: 'Study chat' });

    await user.click(trigger);
    const dialog = await screen.findByRole('dialog', { name: 'Study chat' });
    const input = within(dialog).getByRole('textbox', { name: 'Message' });
    const send = within(dialog).getByRole('button', { name: 'Send message' });

    expect(send).toBeDisabled();
    await user.type(input, '   ');
    expect(send).toBeDisabled();
    await user.clear(input);
    await user.type(input, 'Explain this topic{Shift>}{Enter}{/Shift}with an example');
    expect(within(dialog).queryAllByRole('article')).toHaveLength(0);
    await user.keyboard('{Enter}');
    expect(within(dialog).getAllByRole('article')).toHaveLength(1);
    expect(within(dialog).getByRole('article')).toHaveTextContent(
      'Explain this topic with an example'
    );
    expect(input).toHaveValue('');
    expect(input).toHaveFocus();
    await user.type(input, 'Keep this draft');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(trigger).toHaveFocus());
    await user.click(trigger);
    await screen.findByRole('dialog');
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('Keep this draft');
    expect(screen.getAllByRole('article')).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Send message' }));
    expect(screen.getAllByRole('article')).toHaveLength(2);
  }
);

testStable('does not submit while an input method is composing text', async () => {
  const user = userEvent.setup();

  render(<ChatHarness />);
  await user.click(screen.getByRole('button', { name: 'Study chat' }));
  const input = await screen.findByRole('textbox', { name: 'Message' });

  fireEvent.change(input, { target: { value: '日本語' } });
  fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
  expect(screen.queryAllByRole('article')).toHaveLength(0);
  expect(input).toHaveValue('日本語');
});
