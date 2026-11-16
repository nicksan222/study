import { test } from '@study/testing';

import { useAssistantComposer } from './use-composer';

function Composer({ send }: { send: () => boolean }) {
  const model = useAssistantComposer({ send });

  return (
    <>
      <textarea aria-label="Draft" ref={model.input} onKeyDown={model.onKeyDown} />
      <button onClick={model.send}>Send</button>
    </>
  );
}

test.stable(
  'focuses the shared chat input only after an accepted send and respects composition and multiline input',
  async ({ vi, userEvent, render, screen, fireEvent, expect }) => {
    const send = vi.fn(() => true);
    const user = userEvent.setup();

    render(<Composer send={send} />);
    const input = screen.getByRole('textbox', { name: 'Draft' });

    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
    expect(send).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(input).toHaveFocus();
    send.mockReturnValue(false);
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(screen.getByRole('button', { name: 'Send' })).toHaveFocus();
  }
);
