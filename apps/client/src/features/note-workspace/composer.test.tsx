import {
  StudyError,
  noteIdSchema,
  askResultSchema,
  defaultWorkspacePreferences
} from '@study/contracts';
import { test } from '@study/testing';
import { Schema } from 'effect';
import { AtomRegistry } from 'effect/reactivity';

let Composer: typeof __MockType0.Composer;

let composerDraft: typeof __MockType1.composerDraft;

import type * as __MockType0 from './composer';
import type * as __MockType1 from './composer.queries';
import type * as NoteQueries from './note-workspace.queries';
import type * as __MockType2 from './note-workspace.queries';

let ask: typeof __MockType2.ask;

let saveNote: typeof __MockType2.saveNote;

let preferences: ReturnType<typeof createMockState>['preferences'];

const id = Schema.decodeUnknownSync(noteIdSchema)(9007199254740993n);

const receipt = Schema.decodeUnknownSync(askResultSchema)({
  noteId: id,
  requestId: 'request-exact',
  messageId: 3n,
  versionId: 4n,
  userMessageId: 1n,
  userVersionId: 2n
});

function createMockState() {
  return {
    preferences: (() => ({ submitOnEnter: false }))()
  };
}

test.unit.beforeEach(async ({ mock }) => {
  const __mockState = createMockState();

  preferences = __mockState.preferences;

  mock('#client/lib/i18n.tsx', () => ({
    useI18n: () => ({ t: (key: string) => key, locale: 'italian' })
  }));
  mock('#client/features/note-workspace/note-workspace.queries', async (importOriginal) => {
    const actual = await importOriginal<typeof NoteQueries>();

    return {
      ...actual,
      ask: mock.fn(),
      saveNote: mock.fn()
    };
  });
  mock('#client/lib/study-client/workspace-preferences.queries.ts', () => ({
    useWorkspacePreferences: () => ({ ...defaultWorkspacePreferences, ...preferences })
  }));
  const __mockModule0 = await import('./composer');

  Composer = __mockModule0.Composer;
  const __mockModule1 = await import('./composer.queries');

  composerDraft = __mockModule1.composerDraft;
  const __mockModule2 = await import('./note-workspace.queries');

  ask = __mockModule2.ask;
  saveNote = __mockModule2.saveNote;
});

test.unit.beforeEach(({ vi }) => vi.clearAllMocks());

function mount(
  { rpcTestTransport, render }: Pick<test.unit.Context, 'rpcTestTransport' | 'render'>,
  cache = AtomRegistry.make()
) {
  const { wrapper: Provider } = rpcTestTransport(async (tag) => {
    if (tag === 'notes.noteSelection') return { revision: 8n, targets: [] };

    throw new StudyError('unsupported', tag);
  }, cache);

  return {
    cache,
    ...render(
      <Provider>
        <Composer id={id} />
      </Provider>
    )
  };
}

test.unit.stable(
  'captures a note without chat controls and preserves later typing after its save',
  async ({ vi, expect, screen, fireEvent, waitFor, act, rpcTestTransport, render }) => {
    let resolve!: (value: Awaited<ReturnType<typeof saveNote>>) => void;

    vi.mocked(saveNote).mockImplementation(
      () =>
        new Promise((accept) => {
          resolve = accept;
        })
    );
    mount({ rpcTestTransport, render });
    fireEvent.click(screen.getByRole('button', { name: 'NoteAddCapture' }));
    expect(screen.queryByRole('button', { name: 'NoteAsk' })).toBeNull();
    expect(screen.queryByTitle('NoteGenerationPreferences')).toBeNull();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Lecture notes' } });
    await waitFor(() => expect(screen.getByRole('button', { name: 'NoteSaveNote' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'NoteSaveNote' }));
    await waitFor(() => expect(saveNote).toHaveBeenCalledExactlyOnceWith(id, 'Lecture notes'));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Later draft' } });
    await act(async () => resolve({} as Awaited<ReturnType<typeof saveNote>>));
    await waitFor(() => expect(screen.getByRole('textbox')).toHaveValue('Later draft'));
    expect(ask).not.toHaveBeenCalled();
  }
);

test.unit.stable(
  'recovers an already stored ambiguous Ask after navigation without exposing new chat controls',
  async ({ vi, expect, screen, fireEvent, waitFor, rpcTestTransport, render }) => {
    vi.mocked(ask)
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
    const first = mount({ rpcTestTransport, render }, cache);

    expect(screen.queryByRole('button', { name: 'NoteAsk' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'NoteRetryAsk' }));
    await screen.findByRole('alert');
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'Do not send this yet' }
    });
    first.unmount();
    mount({ rpcTestTransport, render }, cache);
    fireEvent.click(screen.getByRole('button', { name: 'NoteRetryAsk' }));
    await waitFor(() => expect(ask).toHaveBeenCalledTimes(2));
    expect(vi.mocked(ask).mock.calls[1]![0]).toEqual(submitted);
    expect(saveNote).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole('textbox')).toHaveValue('Do not send this yet'));
  }
);

test.unit.stable(
  'does not automatically resubmit a note whose save was not confirmed',
  async ({ vi, fireEvent, screen, waitFor, expect, rpcTestTransport, render }) => {
    vi.mocked(saveNote).mockRejectedValue(new StudyError('transient', 'Unconfirmed'));
    mount({ rpcTestTransport, render });
    fireEvent.click(screen.getByRole('button', { name: 'NoteAddCapture' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Keep this note' } });
    await waitFor(() => expect(screen.getByRole('button', { name: 'NoteSaveNote' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'NoteSaveNote' }));
    await screen.findByText('NoteNoteUncertain');
    expect(saveNote).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'NoteSaveNote' })).toBeDisabled();
    expect(screen.getByRole('textbox')).toHaveValue('Keep this note');
    expect(ask).not.toHaveBeenCalled();
  }
);

test.unit.stable(
  'keeps plain capture available while selection edits remain unsaved',
  async ({ vi, fireEvent, screen, expect, waitFor, rpcTestTransport, render }) => {
    const cache = AtomRegistry.make();

    vi.mocked(saveNote).mockResolvedValue({} as Awaited<ReturnType<typeof saveNote>>);
    mount({ rpcTestTransport, render }, cache);
    fireEvent.click(screen.getByRole('button', { name: 'NoteAddCapture' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'A quick note' } });
    expect(screen.queryByRole('button', { name: 'NoteAsk' })).toBeNull();
    await waitFor(() => expect(screen.getByRole('button', { name: 'NoteSaveNote' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'NoteSaveNote' }));
    await waitFor(() => expect(saveNote).toHaveBeenCalledWith(id, 'A quick note'));
    expect(ask).not.toHaveBeenCalled();
  }
);

test.unit.stable(
  'saves a note with the primary keyboard shortcut without asking for a reply',
  async ({ vi, fireEvent, screen, waitFor, expect, rpcTestTransport, render }) => {
    vi.mocked(saveNote).mockResolvedValue({} as Awaited<ReturnType<typeof saveNote>>);
    mount({ rpcTestTransport, render });
    fireEvent.click(screen.getByRole('button', { name: 'NoteAddCapture' }));
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'Rough lecture notes' }
    });
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter', ctrlKey: true });
    await waitFor(() => expect(saveNote).toHaveBeenCalledWith(id, 'Rough lecture notes'));
    expect(ask).not.toHaveBeenCalled();
  }
);

test.unit.stable(
  'keeps Enter and composition keystrokes in the notebook editor',
  ({ fireEvent, screen, expect, rpcTestTransport, render }) => {
    mount({ rpcTestTransport, render });
    fireEvent.click(screen.getByRole('button', { name: 'NoteAddCapture' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'First line' } });
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
    fireEvent.keyDown(screen.getByRole('textbox'), {
      key: 'Enter',
      ctrlKey: true,
      isComposing: true
    });
    expect(saveNote).not.toHaveBeenCalled();
    expect(ask).not.toHaveBeenCalled();
  }
);

test.unit.stable(
  'optionally submits Enter while preserving Shift+Enter and composition',
  async ({ vi, screen, fireEvent, expect, waitFor, rpcTestTransport, render }) => {
    preferences.submitOnEnter = true;
    vi.mocked(saveNote).mockImplementation(() => new Promise(() => {}));
    mount({ rpcTestTransport, render });
    fireEvent.click(screen.getByRole('button', { name: 'NoteAddCapture' }));
    const input = screen.getByRole('textbox');

    fireEvent.change(input, { target: { value: 'Quick thought' } });
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
    expect(saveNote).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(saveNote).toHaveBeenCalledTimes(1));
    preferences.submitOnEnter = false;
  }
);

test.unit.stable(
  'keeps an unsent capture when its input is closed and reopened',
  ({ fireEvent, screen, expect, rpcTestTransport, render }) => {
    mount({ rpcTestTransport, render });
    expect(screen.queryByRole('textbox')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'NoteAddCapture' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Keep this rough thought' } });
    fireEvent.click(screen.getByRole('button', { name: 'NoteHideCapture' }));
    expect(screen.queryByRole('textbox')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'NoteAddCapture' }));
    expect(screen.getByRole('textbox')).toHaveValue('Keep this rough thought');
    expect(saveNote).not.toHaveBeenCalled();
  }
);
