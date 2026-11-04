import { testStable } from '@study/testing/vitest';
import {
  ChatConversation,
  ChatMessage,
  ChatMessageText,
  ChatMessageActionToolbar
} from '@study/ui/chat';
import { fireEvent, render, screen } from '@testing-library/react';
import { expect } from 'vite-plus/test';

testStable(
  'keeps the reading anchor on older-page insertion and follows new arrivals only at the end',
  () => {
    const view = render(
      <ChatConversation label="Session" jumpLabel="Latest" itemCount={3} firstItemKey="b">
        <p>Notes</p>
      </ChatConversation>
    );
    const viewport = screen.getByRole('log', { name: 'Session' });
    let height = 2000;

    Object.defineProperties(viewport, {
      scrollHeight: { get: () => height },
      clientHeight: { value: 500 }
    });
    viewport.scrollTop = 100;
    fireEvent.scroll(viewport);
    expect(screen.getByRole('button', { name: 'Latest' })).toBeInTheDocument();
    height = 2400;
    view.rerender(
      <ChatConversation label="Session" jumpLabel="Latest" itemCount={4} firstItemKey="a">
        <p>Older notes</p>
      </ChatConversation>
    );
    expect(viewport.scrollTop).toBe(500);
    height = 2600;
    view.rerender(
      <ChatConversation label="Session" jumpLabel="Latest" itemCount={5} firstItemKey="a">
        <p>New note</p>
      </ChatConversation>
    );
    expect(viewport.scrollTop).toBe(500);
    viewport.scrollTop = 2100;
    fireEvent.scroll(viewport);
    expect(screen.queryByRole('button', { name: 'Latest' })).not.toBeInTheDocument();
    height = 2900;
    view.rerender(
      <ChatConversation label="Session" jumpLabel="Latest" itemCount={6} firstItemKey="a">
        <p>Another note</p>
      </ChatConversation>
    );
    expect(viewport.scrollTop).toBe(2900);
  }
);

testStable('keeps quick notes literal and exposes their actions to keyboard users', () => {
  render(
    <ChatMessage>
      <ChatMessageText text={'**Literal note**\nSecond line'} />
      <ChatMessageActionToolbar aria-label="Note actions">
        <button>Edit</button>
      </ChatMessageActionToolbar>
    </ChatMessage>
  );
  expect(screen.getByText('**Literal note** Second line')).toHaveTextContent('**Literal note**');
  expect(screen.getByRole('group', { name: 'Note actions' })).toContainElement(
    screen.getByRole('button', { name: 'Edit' })
  );
});
