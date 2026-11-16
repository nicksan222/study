import { test } from '@study/testing';

import type { AssistantHarness } from '#client/test/assistant.tsx';

let mount: AssistantHarness['mountAssistant'];

test.unit.beforeEach(({ assistant }) => {
  mount = assistant.mountAssistant;
});

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
