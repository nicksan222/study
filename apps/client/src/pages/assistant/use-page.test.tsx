import { test } from '@study/testing';

import type { AssistantHarness } from '#client/test/assistant.tsx';

let mount: AssistantHarness['mountAssistant'];

test.beforeEach(({ assistant }) => {
  mount = assistant.mountAssistant;
});

test.stable('does not send during input-method composition or dismiss on Escape', async () => {
  await mount();
  const input = await test.screen.findByRole('textbox', { name: 'Message' });

  await test.waitFor(() => test.expect(input).toBeEnabled());

  test.fireEvent.change(input, { target: { value: '日本語' } });
  test.fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
  test.expect(test.screen.queryAllByRole('article')).toHaveLength(0);
  test.expect(input).toHaveValue('日本語');
  test.fireEvent.keyDown(input, { key: 'Escape' });
  test.expect(test.screen.getByRole('heading', { name: 'Assistant' })).toBeInTheDocument();
});
