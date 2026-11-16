import {
  StudyError,
  noteIdSchema,
  askResultSchema,
  defaultWorkspacePreferences
} from '@study/contracts';
import { test } from '@study/testing';
import { Schema } from 'effect';
import { AtomRegistry } from 'effect/reactivity';

import { Composer } from './composer';
import { composerDraft } from './composer.queries';
import type * as NoteQueries from './note-workspace.queries';
import { ask, saveNote } from './note-workspace.queries';

test.mock('#client/lib/i18n.tsx', () => ({
  useI18n: () => ({ t: (key: string) => key, locale: 'italian' })
}));
test.mock('./note-workspace.queries', async (importOriginal) => {
  const actual = await importOriginal<typeof NoteQueries>();

  return {
    ...actual,
    ask: test.vi.fn(),
    saveNote: test.vi.fn()
  };
});

const preferences = test.hoisted(() => ({ submitOnEnter: false }));

test.mock('#client/lib/study-client/workspace-preferences.queries.ts', () => ({
  useWorkspacePreferences: () => ({ ...defaultWorkspacePreferences, ...preferences })
}));

const id = Schema.decodeUnknownSync(noteIdSchema)(9007199254740993n);

const receipt = Schema.decodeUnknownSync(askResultSchema)({
  noteId: id,
  requestId: 'request-exact',
  messageId: 3n,
  versionId: 4n,
  userMessageId: 1n,
  userVersionId: 2n
});

test.beforeEach(() => test.vi.clearAllMocks());

function mount(cache = AtomRegistry.make()) {
  const { wrapper: Provider } = test.rpcTestTransport(async (tag) => {
    if (tag === 'notes.noteSelection') return { revision: 8n, targets: [] };

    throw new StudyError('unsupported', tag);
  }, cache);

  return {
    cache,
    ...test.render(
      <Provider>
        <Composer id={id} />
      </Provider>
    )
  };
}

test.stable(
  'captures a note without chat controls and preserves later typing after its save',
  async () => {
    let resolve!: (value: Awaited<ReturnType<typeof saveNote>>) => void;

    test.vi.mocked(saveNote).mockImplementation(
      () =>
        new Promise((accept) => {
          resolve = accept;
        })
    );
    mount();
    test.expect(test.screen.queryByRole('button', { name: 'NoteAsk' })).toBeNull();
    test.expect(test.screen.queryByTitle('NoteGenerationPreferences')).toBeNull();
    test.fireEvent.change(test.screen.getByRole('textbox'), { target: { value: 'Lecture notes' } });
    await test.waitFor(() =>
      test.expect(test.screen.getByRole('button', { name: 'NoteSaveNote' })).toBeEnabled()
    );
    test.fireEvent.click(test.screen.getByRole('button', { name: 'NoteSaveNote' }));
    await test.waitFor(() =>
      test.expect(saveNote).toHaveBeenCalledExactlyOnceWith(id, 'Lecture notes', [])
    );
    test.fireEvent.change(test.screen.getByRole('textbox'), { target: { value: 'Later draft' } });
    await test.act(async () => resolve({} as Awaited<ReturnType<typeof saveNote>>));
    await test.waitFor(() =>
      test.expect(test.screen.getByRole('textbox')).toHaveValue('Later draft')
    );
    test.expect(ask).not.toHaveBeenCalled();
  }
);

test.stable(
  'recovers an already stored ambiguous Ask after navigation without exposing new chat controls',
  async () => {
    test.vi
      .mocked(ask)
      .mockRejectedValueOnce(new StudyError('transient', 'Unconfirmed'))
      .mockResolvedValueOnce(receipt);
    const cache = AtomRegistry.make();
    const submitted = {
      noteId: id,
      intentKey: 'retained-ask',
      expectedSelectionRevision: 8n,
      text: 'Original question'
    };

    cache.set(composerDraft(id), {
      text: 'Original question',
      instruction: '',
      askAttempt: submitted
    });
    const first = mount(cache);

    test.expect(test.screen.queryByRole('button', { name: 'NoteAsk' })).toBeNull();
    test.fireEvent.click(test.screen.getByRole('button', { name: 'NoteRetryAsk' }));
    await test.screen.findByRole('alert');
    test.fireEvent.change(test.screen.getByRole('textbox'), {
      target: { value: 'Do not send this yet' }
    });
    first.unmount();
    mount(cache);
    test.fireEvent.click(test.screen.getByRole('button', { name: 'NoteRetryAsk' }));
    await test.waitFor(() => test.expect(ask).toHaveBeenCalledTimes(2));
    test.expect(test.vi.mocked(ask).mock.calls[1]![0]).toEqual(submitted);
    test.expect(saveNote).not.toHaveBeenCalled();
    await test.waitFor(() =>
      test.expect(test.screen.getByRole('textbox')).toHaveValue('Do not send this yet')
    );
  }
);

test.stable('does not automatically resubmit a note whose save was not confirmed', async () => {
  test.vi.mocked(saveNote).mockRejectedValue(new StudyError('transient', 'Unconfirmed'));
  mount();
  test.fireEvent.change(test.screen.getByRole('textbox'), { target: { value: 'Keep this note' } });
  await test.waitFor(() =>
    test.expect(test.screen.getByRole('button', { name: 'NoteSaveNote' })).toBeEnabled()
  );
  test.fireEvent.click(test.screen.getByRole('button', { name: 'NoteSaveNote' }));
  await test.screen.findByText('NoteNoteUncertain');
  test.expect(saveNote).toHaveBeenCalledTimes(1);
  test.expect(test.screen.getByRole('button', { name: 'NoteSaveNote' })).toBeDisabled();
  test.expect(test.screen.getByRole('textbox')).toHaveValue('Keep this note');
  test.expect(ask).not.toHaveBeenCalled();
});

test.stable('keeps plain capture available while selection edits remain unsaved', async () => {
  const cache = AtomRegistry.make();

  test.vi.mocked(saveNote).mockResolvedValue({} as Awaited<ReturnType<typeof saveNote>>);
  mount(cache);
  test.fireEvent.change(test.screen.getByRole('textbox'), { target: { value: 'A quick note' } });
  test.expect(test.screen.queryByRole('button', { name: 'NoteAsk' })).toBeNull();
  await test.waitFor(() =>
    test.expect(test.screen.getByRole('button', { name: 'NoteSaveNote' })).toBeEnabled()
  );
  test.fireEvent.click(test.screen.getByRole('button', { name: 'NoteSaveNote' }));
  await test.waitFor(() => test.expect(saveNote).toHaveBeenCalledWith(id, 'A quick note', []));
  test.expect(ask).not.toHaveBeenCalled();
});

test.stable(
  'saves a note with the primary keyboard shortcut without asking for a reply',
  async () => {
    test.vi.mocked(saveNote).mockResolvedValue({} as Awaited<ReturnType<typeof saveNote>>);
    mount();
    test.fireEvent.change(test.screen.getByRole('textbox'), {
      target: { value: 'Rough lecture notes' }
    });
    test.fireEvent.keyDown(test.screen.getByRole('textbox'), { key: 'Enter', ctrlKey: true });
    await test.waitFor(() =>
      test.expect(saveNote).toHaveBeenCalledWith(id, 'Rough lecture notes', [])
    );
    test.expect(ask).not.toHaveBeenCalled();
  }
);

test.stable('keeps Enter and composition keystrokes in the notebook editor', () => {
  mount();
  test.fireEvent.change(test.screen.getByRole('textbox'), { target: { value: 'First line' } });
  test.fireEvent.keyDown(test.screen.getByRole('textbox'), { key: 'Enter' });
  test.fireEvent.keyDown(test.screen.getByRole('textbox'), {
    key: 'Enter',
    ctrlKey: true,
    isComposing: true
  });
  test.expect(saveNote).not.toHaveBeenCalled();
  test.expect(ask).not.toHaveBeenCalled();
});

test.stable('optionally submits Enter while preserving Shift+Enter and composition', async () => {
  preferences.submitOnEnter = true;
  test.vi.mocked(saveNote).mockImplementation(() => new Promise(() => {}));
  mount();
  const input = test.screen.getByRole('textbox');

  test.fireEvent.change(input, { target: { value: 'Quick thought' } });
  test.fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
  test.fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
  test.expect(saveNote).not.toHaveBeenCalled();
  test.fireEvent.keyDown(input, { key: 'Enter' });
  await test.waitFor(() => test.expect(saveNote).toHaveBeenCalledTimes(1));
  preferences.submitOnEnter = false;
});
