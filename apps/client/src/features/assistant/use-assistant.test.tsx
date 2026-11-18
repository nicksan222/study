import { askResultSchema } from '@study/contracts';
import { test } from '@study/testing';
import { Schema } from 'effect';

import type { AssistantHarness } from '#client/test/assistant.tsx';

const readiness = { state: 'ready' };

let api: AssistantHarness['api'];

let message: AssistantHarness['message'];

let mountAssistant: AssistantHarness['mountAssistant'];

test.unit.beforeEach(({ assistant, mock }) => {
  readiness.state = 'ready';
  mock('#client/lib/ai-readiness-notice.tsx', () => ({ AiReadinessNotice: () => null }));
  mock('#client/lib/ai-readiness.ts', () => ({ useAiReadiness: () => readiness.state }));
  mock('#client/lib/host.ts', async (original) => ({
    ...(await original<typeof Host>()),
    microphoneAvailable: () => true,
    captureMicrophone: async () => ({ stop: async () => [0.5], cancel: () => {} })
  }));
  api = assistant.api;
  message = assistant.message;
  mountAssistant = assistant.mountAssistant;
});

test.unit.stable(
  'blocks Assistant Send and Enter while a transcription is in flight',
  async ({ screen, expect, fireEvent, waitFor, userEvent }) => {
    const result = Promise.withResolvers<{ text: string }>();

    api.transcribe.mockReturnValue(result.promise);
    await mountAssistant();
    const input = await screen.findByRole('textbox', { name: 'Message' });
    const send = screen.getByRole('button', { name: 'Send message' });
    const user = userEvent.setup();

    await waitFor(() => expect(input).toBeEnabled());
    await user.type(input, 'Explain the');
    await user.click(await screen.findByRole('button', { name: 'Start dictation' }));
    await user.click(await screen.findByRole('button', { name: 'Stop and transcribe' }));
    await waitFor(() => expect(api.transcribe).toHaveBeenCalledOnce());
    expect(send).toBeDisabled();
    await user.click(send);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(api.ask).not.toHaveBeenCalled();
    result.resolve({ text: 'water cycle.' });
    await waitFor(() => expect(send).toBeEnabled());
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() =>
      expect(api.ask).toHaveBeenCalledWith(
        expect.objectContaining({ text: 'Explain the water cycle.' })
      )
    );
  }
);

test.unit.stable(
  'keeps local Assistant dictation available while signed out',
  async ({ screen, expect, waitFor, userEvent }) => {
    readiness.state = 'signed-out';
    api.transcribe.mockResolvedValue({ text: 'Saved locally.' });
    await mountAssistant();
    const input = await screen.findByRole('textbox', { name: 'Message' });
    const user = userEvent.setup();

    await waitFor(() => expect(input).toBeEnabled());
    await user.click(await screen.findByRole('button', { name: 'Start dictation' }));
    await user.click(await screen.findByRole('button', { name: 'Stop and transcribe' }));
    await waitFor(() => expect(input).toHaveValue('Saved locally.'));
    expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled();
  }
);

test.unit.stable(
  'reuses the same intent after an uncertain send failure and preserves the draft',
  async ({ screen, waitFor, expect, fireEvent }) => {
    api.ask.mockRejectedValueOnce(new Error('Connection lost'));
    await mountAssistant();
    const input = await screen.findByRole('textbox', { name: 'Message' });

    await waitFor(() => expect(input).toBeEnabled());
    fireEvent.change(input, { target: { value: 'Keep this request' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    await screen.findByText(/Could not load or send/);
    expect(input).toHaveValue('Keep this request');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() =>
      expect(screen.queryByText(/Could not load or send/)).not.toBeInTheDocument()
    );
    expect(input).toHaveValue('Keep this request');
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    await waitFor(() => expect(api.ask).toHaveBeenCalledTimes(2));
    expect(api.ask.mock.calls[1][0]).toEqual(api.ask.mock.calls[0][0]);
  }
);

test.unit.stable(
  'editing the next draft cannot detach an in-flight send or allow a second send',
  async ({ screen, waitFor, expect, fireEvent }) => {
    api.ask.mockImplementation(() => new Promise(() => {}));
    await mountAssistant();
    const input = await screen.findByRole('textbox', { name: 'Message' });

    await waitFor(() => expect(input).toBeEnabled());
    fireEvent.change(input, { target: { value: 'First request' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    await waitFor(() => expect(api.ask).toHaveBeenCalledTimes(1));
    fireEvent.change(input, { target: { value: 'Next draft' } });
    expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled();
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(api.ask).toHaveBeenCalledTimes(1);
    expect(input).toHaveValue('Next draft');
  }
);

test.unit.stable(
  'renders saved user and Assistant messages separately with safe Markdown',
  async ({ screen, expect }) => {
    api.thread.mockResolvedValue({
      items: [
        message('user', 'Explain gravity.', 1n),
        message('assistant', '**Gravity** attracts mass.', 2n)
      ],
      next: null
    });
    await mountAssistant();
    const user = await screen.findByRole('article', { name: 'You' });
    const assistant = await screen.findByRole('article', { name: 'Assistant' });

    expect(user).toHaveAttribute('data-role', 'user');
    expect(assistant).toHaveAttribute('data-role', 'assistant');
    expect(assistant.querySelector('strong')).toHaveTextContent('Gravity');
  }
);

test.unit.stable(
  'creates a separate chat and restores the earlier chat draft from the history card',
  async ({ screen, waitFor, expect, fireEvent }) => {
    api.chats.mockResolvedValue({
      items: [
        {
          id: 91n,
          title: 'Earlier note',
          projectIds: [],
          titleSource: 'user',
          archivedAt: null,
          createdAt: 1n,
          updatedAt: 1n
        }
      ],
      next: null
    });
    await mountAssistant();
    const input = await screen.findByRole('textbox', { name: 'Message' });

    await waitFor(() => expect(input).toBeEnabled());
    fireEvent.change(input, { target: { value: 'Draft for the earlier chat' } });
    fireEvent.click(screen.getByRole('button', { name: 'Chat history' }));
    fireEvent.click(screen.getByRole('button', { name: 'New chat' }));
    await waitFor(() => expect(api.newChat).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(api.note).toHaveBeenCalledWith({ id: 92n }));
    await waitFor(() => expect(input).toBeEnabled());
    expect(input).toHaveValue('');
    fireEvent.change(input, { target: { value: 'Draft for the new chat' } });
    fireEvent.click(screen.getByRole('button', { name: 'Earlier note' }));
    await waitFor(() => expect(input).toHaveValue('Draft for the earlier chat'));
    const send = screen.getByRole('button', { name: 'Send message' });

    await waitFor(() => expect(send).toBeEnabled());
    fireEvent.click(send);
    await waitFor(() =>
      expect(api.ask).toHaveBeenCalledWith(
        expect.objectContaining({ noteId: 91n, text: 'Draft for the earlier chat' })
      )
    );
  }
);

test.unit.stable(
  'shows an estimated context ring that includes the unsent draft',
  async ({ screen, expect, fireEvent }) => {
    await mountAssistant();
    const meter = await screen.findByRole('meter');

    expect(meter).toHaveAttribute('aria-valuenow', '16');
    fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), {
      target: { value: 'a'.repeat(4000) }
    });
    expect(meter).toHaveAttribute('aria-valuenow', '18');
    expect(meter).toHaveAccessibleName(/Auto compact is on/);
  }
);

test.unit.stable(
  'an idle chat does not keep polling its history and context',
  async ({ screen, waitFor, expect, vi, act }) => {
    await mountAssistant();
    await screen.findByRole('meter');
    await waitFor(() => expect(api.thread).toHaveBeenCalled());
    const threadCalls = api.thread.mock.calls.length;
    const contextCalls = api.context.mock.calls.length;

    vi.useFakeTimers();

    try {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3500);
      });
      expect(api.thread).toHaveBeenCalledTimes(threadCalls);
      expect(api.context).toHaveBeenCalledTimes(contextCalls);
    } finally {
      vi.useRealTimers();
    }
  }
);

test.unit.stable(
  'a delayed send only clears its original chat draft after creating another chat',
  async ({ screen, waitFor, expect, fireEvent, act }) => {
    let finish!: (value: Awaited<ReturnType<typeof api.ask>>) => void;

    api.ask.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    await mountAssistant();
    const input = await screen.findByRole('textbox', { name: 'Message' });

    await waitFor(() => expect(input).toBeEnabled());
    fireEvent.change(input, { target: { value: 'Same text' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    await waitFor(() => expect(api.ask).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: 'Chat history' }));
    fireEvent.click(screen.getByRole('button', { name: 'New chat' }));
    await waitFor(() => expect(api.note).toHaveBeenCalledWith({ id: 92n }));
    await waitFor(() => expect(input).toBeEnabled());
    fireEvent.change(input, { target: { value: 'Same text' } });
    await act(async () => {
      finish(
        Schema.decodeUnknownSync(askResultSchema)({
          noteId: 91n,
          messageId: 2n,
          versionId: 2n,
          requestId: 'finished',
          userMessageId: 1n,
          userVersionId: 1n
        })
      );
    });
    await waitFor(() => expect(input).toHaveValue('Same text'));
  }
);

test.unit.stable(
  'blocks new sends while setup is needed and keeps the draft editable',
  async ({ screen, waitFor, expect, fireEvent }) => {
    readiness.state = 'setup';

    try {
      await mountAssistant();
      const input = await screen.findByRole('textbox', { name: 'Message' });

      await waitFor(() => expect(input).toBeEnabled());
      fireEvent.change(input, { target: { value: 'Keep this draft' } });
      expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled();
      fireEvent.keyDown(input, { key: 'Enter' });
      expect(api.ask).not.toHaveBeenCalled();
      expect(input).toHaveValue('Keep this draft');
    } finally {
      readiness.state = 'ready';
    }
  }
);

test.unit.stable(
  'server snapshots refresh committed content while the local question draft survives',
  async ({ screen, waitFor, expect, fireEvent, act }) => {
    const { notify } = await mountAssistant();
    const input = await screen.findByRole('textbox', { name: 'Message' });

    await waitFor(() => expect(input).toBeEnabled());
    fireEvent.change(input, { target: { value: 'Keep this question' } });
    api.thread.mockResolvedValue({
      items: [message('assistant', 'Updated from another window.', 2n)],
      next: null
    });
    await act(async () => {
      await notify();
    });
    expect(await screen.findByText('Updated from another window.')).toBeInTheDocument();
    expect(input).toHaveValue('Keep this question');
  }
);
import type * as Host from '#client/lib/host.ts';
