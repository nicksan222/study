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
  async () => {
    const send = test.vi.fn(() => true);
    const user = test.userEvent.setup();

    test.render(<Composer send={send} />);
    const input = test.screen.getByRole('textbox', { name: 'Draft' });

    test.fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
    test.fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
    test.expect(send).not.toHaveBeenCalled();
    await user.click(test.screen.getByRole('button', { name: 'Send' }));
    test.expect(input).toHaveFocus();
    send.mockReturnValue(false);
    await user.click(test.screen.getByRole('button', { name: 'Send' }));
    test.expect(test.screen.getByRole('button', { name: 'Send' })).toHaveFocus();
  }
);
