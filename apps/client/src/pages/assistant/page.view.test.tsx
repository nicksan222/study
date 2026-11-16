import { test } from '@study/testing';

import type { AssistantHarness } from '#client/test/assistant.tsx';

let api: AssistantHarness['api'];

let mount: AssistantHarness['mountAssistant'];

test.beforeEach(({ assistant, mock }) => {
  mock('#client/lib/ai-readiness.ts', () => ({ useAiReadiness: () => 'ready' }));
  api = assistant.api;
  mount = assistant.mountAssistant;
});

test.stable(
  'sends only nonblank user messages and supports multiline drafts',
  async ({ userEvent, screen, waitFor, expect }) => {
    const user = userEvent.setup();

    await mount();
    const input = await screen.findByRole('textbox', { name: 'Message' });

    await waitFor(() => expect(input).toBeEnabled());
    const send = screen.getByRole('button', { name: 'Send message' });

    expect(send).toBeDisabled();
    await user.type(input, '   ');
    expect(send).toBeDisabled();
    await user.clear(input);
    await user.type(input, 'Explain this topic{Shift>}{Enter}{/Shift}with an example');
    expect(screen.queryAllByRole('article')).toHaveLength(0);
    await user.keyboard('{Enter}');
    await waitFor(() => expect(api.ask).toHaveBeenCalledOnce());
    expect(await screen.findByRole('article', { name: 'You' })).toHaveTextContent(
      'Explain this topic with an example'
    );
    await waitFor(() => expect(input).toHaveValue(''));
    expect(input).toHaveFocus();
    expect(screen.getByRole('article', { name: 'Assistant' })).toHaveAttribute(
      'data-role',
      'assistant'
    );
  }
);
