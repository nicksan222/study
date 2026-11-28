import { test } from '@study/testing';

import type { AssistantHarness } from '#client/test/assistant.tsx';

let mount: AssistantHarness['mountAssistant'];

test.unit.beforeEach(({ assistant }) => {
  mount = assistant.mountAssistant;
});

test.unit.stable(
  'dismisses Assistant history from inside the panel and returns focus to its toggle',
  async ({ screen, userEvent, expect }) => {
    await mount();
    const user = userEvent.setup();
    const toggle = screen.getByRole('button', { name: 'Chat history' });

    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await user.click(toggle);
    const history = screen.getByRole('complementary', { name: 'Chat history' });

    expect(toggle).toHaveAttribute('aria-controls', history.id);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    screen.getByRole('button', { name: 'New chat' }).focus();
    await user.keyboard('{Escape}');
    expect(history).not.toBeVisible();
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveFocus();
  }
);

test.unit.stable(
  'does not send during input-method composition or dismiss on Escape',
  async ({ screen, waitFor, expect, fireEvent }) => {
    await mount();
    const input = await screen.findByRole('textbox', { name: 'Message' });

    await waitFor(() => expect(input).toBeEnabled());

    fireEvent.change(input, { target: { value: '日本語' } });
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
    expect(screen.queryAllByRole('article')).toHaveLength(0);
    expect(input).toHaveValue('日本語');
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.getByRole('heading', { name: 'Assistant' })).toBeInTheDocument();
  }
);
