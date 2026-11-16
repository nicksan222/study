import { test } from '@study/testing';
import { ChatNote, ChatMessage, ChatMessageText, ChatMessageActionToolbar } from '@study/ui';

test.stable(
  'keeps the reading anchor on older-page insertion and follows new arrivals only at the end',
  () => {
    const view = test.render(
      <ChatNote label="Note" jumpLabel="Latest" itemCount={3} firstItemKey="b">
        <p>Notes</p>
      </ChatNote>
    );
    const viewport = test.screen.getByRole('log', { name: 'Note' });
    let height = 2000;

    Object.defineProperties(viewport, {
      scrollHeight: { get: () => height },
      clientHeight: { value: 500 }
    });
    viewport.scrollTop = 100;
    test.fireEvent.scroll(viewport);
    test.expect(test.screen.getByRole('button', { name: 'Latest' })).toBeInTheDocument();
    height = 2400;
    view.rerender(
      <ChatNote label="Note" jumpLabel="Latest" itemCount={4} firstItemKey="a">
        <p>Older notes</p>
      </ChatNote>
    );
    test.expect(viewport.scrollTop).toBe(500);
    height = 2600;
    view.rerender(
      <ChatNote label="Note" jumpLabel="Latest" itemCount={5} firstItemKey="a">
        <p>New note</p>
      </ChatNote>
    );
    test.expect(viewport.scrollTop).toBe(500);
    viewport.scrollTop = 2100;
    test.fireEvent.scroll(viewport);
    test.expect(test.screen.queryByRole('button', { name: 'Latest' })).not.toBeInTheDocument();
    height = 2900;
    view.rerender(
      <ChatNote label="Note" jumpLabel="Latest" itemCount={6} firstItemKey="a">
        <p>Another note</p>
      </ChatNote>
    );
    test.expect(viewport.scrollTop).toBe(2900);
  }
);

test.stable('keeps quick notes literal and exposes their actions to keyboard users', () => {
  test.render(
    <ChatMessage>
      <ChatMessageText text={'**Literal note**\nSecond line'} />
      <ChatMessageActionToolbar aria-label="Note actions">
        <button>Edit</button>
      </ChatMessageActionToolbar>
    </ChatMessage>
  );
  test
    .expect(test.screen.getByText('**Literal note** Second line'))
    .toHaveTextContent('**Literal note**');
  test
    .expect(test.screen.getByRole('group', { name: 'Note actions' }))
    .toContainElement(test.screen.getByRole('button', { name: 'Edit' }));
});
