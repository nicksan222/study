import { chatMessageSchema } from '@study/contracts';
import { catalogs } from '@study/localization';
import { test } from '@study/testing';
import { Schema } from 'effect';
import { AtomRegistry } from 'effect/reactivity';

import { readyVoiceStatus } from '#client/test/page-values.ts';

import type { MessageActions as MessageActionsView } from './message-actions';
import type * as NoteQueries from './note-workspace.queries';

const copy = catalogs.english;

const message = Schema.decodeUnknownSync(chatMessageSchema)({
  id: 1n,
  noteId: 2n,
  role: 'user',
  threadRoot: null,
  replyTo: null,
  activeVersionId: 3n,
  recordingId: null,
  recordingMs: null,
  recordedIn: null,
  createdAt: 1n,
  versions: [
    {
      id: 3n,
      number: 1n,
      origin: 'typed',
      status: 'complete',
      text: 'Original field notes',
      basedOn: null,
      instruction: null,
      createdAt: 1n
    }
  ],
  parts: [],
  citations: []
});

let MessageActions: typeof MessageActionsView;

let execute: ReturnType<test.Mock['fn']>;

test.unit.beforeEach(async ({ mock }) => {
  execute = mock.fn(async () => ({ requestId: 'dictated-instruction' }));
  mock('#client/lib/ai-readiness.ts', () => ({ useAiReadiness: () => 'ready' }));
  mock('#client/lib/host.ts', async (original) => ({
    ...(await original<typeof Host>()),
    microphoneAvailable: () => true,
    captureMicrophone: async () => ({ stop: async () => [0.5], cancel: () => {} })
  }));
  mock('#client/features/note-workspace/note-workspace.queries', async (original) => ({
    ...(await original<typeof NoteQueries>()),
    ask: execute,
    rewriteNote: execute
  }));
  ({ MessageActions } = await import('./message-actions'));
});

test.unit.stable.for([
  { mode: 'ask', action: copy.NoteAsk, input: { text: 'Explain the water cycle.' } },
  {
    mode: 'instruction',
    action: copy.NoteApplyAction,
    input: { instruction: 'Explain the water cycle.' }
  }
] as const)(
  'holds the $mode action until the dictated instruction can be included',
  async (
    { mode, action, input },
    { rpcTestTransport, render, screen, userEvent, expect, vi, waitFor, within }
  ) => {
    const { messageActionDraft } = await import('./message-actions.queries');
    const registry = AtomRegistry.make();
    const recognition = Promise.withResolvers<{ text: string }>();
    const transcribe = vi.fn(() => recognition.promise);
    const fixture = rpcTestTransport(async (tag) => {
      if (tag === 'voice.status') return readyVoiceStatus;

      if (tag === 'settings.voiceSettings') return { filterSilence: true };

      if (tag === 'voice.transcribe') return transcribe();

      if (tag === 'notes.noteSelection') return { revision: 1n, targets: [] };

      if (tag === 'notes.message') return message;

      throw new Error(`Unexpected ${tag}`);
    }, registry);

    registry.set(messageActionDraft(message.noteId, message.id), {
      mode,
      targetVersionId: message.activeVersionId!,
      targetText: 'Original field notes',
      text: '',
      instruction: 'Explain the'
    });
    render(
      <MessageActions message={message} versionId={message.activeVersionId!} onActive={() => {}} />,
      { wrapper: fixture.wrapper }
    );
    const dialog = within(await screen.findByRole('dialog'));
    const submit = dialog.getByRole('button', { name: action });
    const user = userEvent.setup();

    await waitFor(() => expect(submit).toBeEnabled());
    await user.click(dialog.getByRole('textbox', { name: copy.NoteInstructions }));
    await user.keyboard('{End}');
    await user.click(await dialog.findByRole('button', { name: copy.VoiceStart }));
    await user.click(await dialog.findByRole('button', { name: copy.VoiceStop }));
    await waitFor(() => expect(transcribe).toHaveBeenCalledOnce());
    expect(submit).toBeDisabled();
    await user.click(submit);
    expect(execute).not.toHaveBeenCalled();
    recognition.resolve({ text: 'water cycle.' });
    await waitFor(() => expect(submit).toBeEnabled());
    await user.click(submit);
    await waitFor(() => expect(execute).toHaveBeenCalledWith(expect.objectContaining(input)));
  }
);
import type * as Host from '#client/lib/host.ts';
