import { test } from '@study/testing';

test.mock('#client/lib/ai-readiness.ts', () => ({ useAiReadiness: () => 'ready' }));

import { api, mountAssistant as mount } from '#client/test/assistant.tsx';

test.stable('sends only nonblank user messages and supports multiline drafts', async () => {
  const user = test.userEvent.setup();

  mount();
  const input = await test.screen.findByRole('textbox', { name: 'Message' });

  await test.waitFor(() => test.expect(input).toBeEnabled());
  const send = test.screen.getByRole('button', { name: 'Send message' });

  test.expect(send).toBeDisabled();
  await user.type(input, '   ');
  test.expect(send).toBeDisabled();
  await user.clear(input);
  await user.type(input, 'Explain this topic{Shift>}{Enter}{/Shift}with an example');
  test.expect(test.screen.queryAllByRole('article')).toHaveLength(0);
  await user.keyboard('{Enter}');
  await test.waitFor(() => test.expect(api.ask).toHaveBeenCalledOnce());
  test
    .expect(await test.screen.findByRole('article', { name: 'You' }))
    .toHaveTextContent('Explain this topic with an example');
  await test.waitFor(() => test.expect(input).toHaveValue(''));
  test.expect(input).toHaveFocus();
  test
    .expect(test.screen.getByRole('article', { name: 'Assistant' }))
    .toHaveAttribute('data-role', 'assistant');
});
