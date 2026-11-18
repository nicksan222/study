import { StudyError, noteIdSchema } from '@study/contracts';
import { test } from '@study/testing';
import { Schema } from 'effect';
import { AtomRegistry } from 'effect/reactivity';

import type * as Host from '#client/lib/host.ts';
import { readyVoiceStatus } from '#client/test/page-values.ts';

import type * as __MockType0 from './transformation';

let Transformation: typeof __MockType0.Transformation;

let api: ReturnType<typeof createMockState>['api'];

const id = noteIdSchema.make(1n);

let fixture: ReturnType<test.unit.Context['rpcTestTransport']>;

let registry: AtomRegistry.AtomRegistry;

let cancelCapture: () => void;

let revision = 1n;

function Provider({ children }: { children: React.ReactNode }) {
  return <fixture.wrapper>{children}</fixture.wrapper>;
}

function createMockState(mock: test.Mock) {
  return {
    api: (() => ({
      suggest: mock.fn(),
      transcribe: mock.fn(),
      capture: mock.fn(),
      readiness: 'ready' as string
    }))()
  };
}

test.unit.beforeEach(async ({ mock }) => {
  const __mockState = createMockState(mock);

  api = __mockState.api;
  cancelCapture = mock.fn();

  mock('#client/lib/ai-readiness.ts', () => ({ useAiReadiness: () => api.readiness }));
  mock('#client/lib/ai-readiness-notice.tsx', () => ({
    AiReadinessNotice: ({ state }: { state: string }) =>
      state === 'ready' ? null : <p>Readiness: {state}</p>
  }));
  mock('#client/lib/i18n.tsx', () => ({
    useI18n: () => ({ t: (key: string) => key, locale: 'english' })
  }));
  mock('#client/features/note-workspace/history', () => ({ CapturedContext: () => null }));
  mock('#client/lib/host.ts', async (load) => ({
    ...(await load<typeof Host>()),
    microphoneAvailable: () => true,
    captureMicrophone: async () => ({ stop: async () => [0.4], cancel: cancelCapture })
  }));
  const __mockModule0 = await import('./transformation');

  Transformation = __mockModule0.Transformation;
});

test.unit.beforeEach(({ vi, rpcTestTransport }) => {
  vi.resetAllMocks();
  api.readiness = 'ready';
  revision = 1n;
  registry = AtomRegistry.make();
  fixture = rpcTestTransport(async (tag, input) => {
    if (tag === 'notes.suggestTransformField') return api.suggest(input);

    if (tag === 'notes.captureNoteContext') return api.capture(input);

    if (tag === 'notes.noteSelection') return { revision, targets: [] };

    if (tag === 'notes.note') {
      const { id } = Schema.decodeUnknownSync(Schema.Struct({ id: noteIdSchema }))(input);

      return {
        id,
        title: 'Note',
        titleSource: 'user',
        projectIds: [],
        archivedAt: null,
        createdAt: 1n,
        updatedAt: 1n
      };
    }

    if (tag === 'notes.noteGenerations') return { items: [], next: null };

    if (tag === 'voice.status') return readyVoiceStatus;

    if (tag === 'voice.transcribe') return api.transcribe(input);

    if (tag === 'settings.voiceSettings') return { filterSilence: true };

    throw new StudyError('unsupported', tag);
  }, registry);
});
test.unit.afterEach(({ cleanup }) => {
  cleanup();
  registry.dispose();
});

function mount({ render }: Pick<test.unit.Context, 'render'>, active = true) {
  return render(
    <Provider>
      <Transformation id={id} active={active} />
    </Provider>
  );
}

test.unit.stable(
  'closing a completed generation request cancels dictation and retains its draft',
  async ({ render, screen, userEvent, expect, waitFor }) => {
    const { transformDraft } = await import('./transformation.queries');
    const user = userEvent.setup();

    registry.set(transformDraft(id), {
      requestId: 'completed-generation',
      title: 'My title',
      instruction: 'Saved instructions',
      operations: ['clarity']
    });
    mount({ render });
    const disclosure = screen.getByText('NoteGenerationRequest');

    await user.click(disclosure);
    await user.click(await screen.findByRole('button', { name: 'VoiceStart' }));
    await screen.findByRole('button', { name: 'VoiceStop' });
    await user.click(disclosure);
    await waitFor(() => expect(cancelCapture).toHaveBeenCalledOnce());
    await user.click(disclosure);
    expect(screen.getByLabelText('NoteInstructions')).toHaveValue('Saved instructions');
    expect(screen.queryByRole('button', { name: 'VoiceStop' })).not.toBeInTheDocument();
  }
);

test.unit.stable(
  'waits for pending dictation before creating a transformed page',
  async ({ render, screen, userEvent, expect, waitFor, act }) => {
    const recognition = Promise.withResolvers<{ text: string }>();
    const user = userEvent.setup();

    api.transcribe.mockReturnValue(recognition.promise);
    api.capture.mockRejectedValue(new StudyError('transient', 'Capture unavailable'));
    mount({ render });
    await user.type(screen.getByLabelText('NoteOutputTitle'), 'My title');
    const create = screen.getByRole('button', { name: 'NoteCreatePage' });

    await waitFor(() => expect(create).toBeEnabled());
    await user.click(await screen.findByRole('button', { name: 'VoiceStart' }));
    await user.click(await screen.findByRole('button', { name: 'VoiceStop' }));
    await waitFor(() => expect(api.transcribe).toHaveBeenCalledOnce());
    expect(create).toBeDisabled();
    expect(api.capture).not.toHaveBeenCalled();
    await act(async () => recognition.resolve({ text: 'Explain the water cycle' }));
    await waitFor(() => expect(create).toBeEnabled());
    await user.click(create);
    await waitFor(() =>
      expect(api.capture).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ instruction: 'Explain the water cycle' })
      )
    );
  }
);

function deferred() {
  let resolve!: (value: string) => void;
  const promise = new Promise<string>((accept) => {
    resolve = accept;
  });

  return { promise, resolve };
}

test.unit.stable(
  'generates each field independently and preserves edits during generation',
  async ({ waitFor, expect, screen, fireEvent, act, render }) => {
    const title = deferred();

    api.suggest.mockImplementation(({ field }: { field: string }) =>
      field === 'title' ? title.promise : Promise.resolve('Explain cell division')
    );
    mount({ render });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'NoteGenerateTitle' })).toBeEnabled()
    );
    fireEvent.click(screen.getByRole('button', { name: 'NoteGenerateTitle' }));
    await waitFor(() => expect(api.suggest).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('button', { name: 'NoteGenerateTitle' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'NoteGenerateInstructions' }));
    await waitFor(() =>
      expect(screen.getByLabelText('NoteInstructions')).toHaveValue('Explain cell division')
    );
    fireEvent.change(screen.getByLabelText('NoteOutputTitle'), {
      target: { value: 'My title' }
    });
    await waitFor(() => expect(screen.getByLabelText('NoteOutputTitle')).toHaveValue('My title'));
    await act(async () => title.resolve('Generated title'));
    expect(screen.getByLabelText('NoteOutputTitle')).toHaveValue('My title');
    expect(api.suggest).toHaveBeenCalledWith(
      expect.objectContaining({ noteId: id, field: 'instruction', language: 'english' })
    );
  }
);

test.unit.stable(
  'ignores old results after dismiss and reopen even when kept mounted',
  async ({ waitFor, expect, screen, fireEvent, act, render }) => {
    const title = deferred();

    api.suggest.mockReturnValue(title.promise);
    const view = mount({ render });

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'NoteGenerateTitle' })).toBeEnabled()
    );
    fireEvent.click(screen.getByRole('button', { name: 'NoteGenerateTitle' }));
    await waitFor(() => expect(api.suggest).toHaveBeenCalledTimes(1));
    view.rerender(
      <Provider>
        <Transformation id={id} active={false} />
      </Provider>
    );
    view.rerender(
      <Provider>
        <Transformation id={id} active />
      </Provider>
    );
    await act(async () => title.resolve('Old title'));
    expect(screen.getByLabelText('NoteOutputTitle')).toHaveValue('');
  }
);

test.unit.stable(
  'shows a field error without clearing the other field and allows retry',
  async ({ waitFor, expect, screen, fireEvent, render }) => {
    api.suggest
      .mockRejectedValueOnce(new StudyError('auth', 'Sign in'))
      .mockResolvedValue('Cell biology');
    mount({ render });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'NoteGenerateTitle' })).toBeEnabled()
    );
    fireEvent.click(screen.getByRole('button', { name: 'NoteGenerateTitle' }));
    await screen.findByRole('alert');
    expect(screen.getByLabelText('NoteInstructions')).toHaveValue('');
    fireEvent.click(screen.getByRole('button', { name: 'NoteGenerateTitle' }));
    await waitFor(() =>
      expect(screen.getByLabelText('NoteOutputTitle')).toHaveValue('Cell biology')
    );
  }
);

test.unit.stable(
  'ignores results after saved context changes or the selected notes change',
  async ({ waitFor, expect, screen, fireEvent, act, render }) => {
    const title = deferred();

    api.suggest.mockReturnValue(title.promise);
    const view = mount({ render });

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'NoteGenerateTitle' })).toBeEnabled()
    );
    fireEvent.click(screen.getByRole('button', { name: 'NoteGenerateTitle' }));
    await waitFor(() => expect(api.suggest).toHaveBeenCalledTimes(1));
    revision = 2n;
    await act(async () => {
      await fixture.notify();
    });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'NoteGenerateTitle' })).toBeEnabled()
    );
    await act(async () => title.resolve('Stale title'));
    expect(screen.getByLabelText('NoteOutputTitle')).toHaveValue('');
    const next = deferred();

    api.suggest.mockReturnValue(next.promise);
    fireEvent.click(screen.getByRole('button', { name: 'NoteGenerateTitle' }));
    await waitFor(() => expect(api.suggest).toHaveBeenCalledTimes(2));
    view.rerender(
      <Provider>
        <Transformation
          id={id}
          notes={[
            { id, title: 'First' },
            { id: noteIdSchema.make(2n), title: 'Second' }
          ]}
        />
      </Provider>
    );
    await act(async () => next.resolve('Wrong group'));
    expect(screen.getByLabelText('NoteOutputTitle')).toHaveValue('');
  }
);

test.unit.stable(
  'disables suggestions above twenty notes without truncating the selection',
  ({ render, expect, screen }) => {
    render(
      <Provider>
        <Transformation
          id={id}
          notes={Array.from({ length: 21 }, (_, index) => ({
            id: noteIdSchema.make(BigInt(index + 1)),
            title: `Note ${index + 1}`
          }))}
        />
      </Provider>
    );
    expect(screen.getByRole('button', { name: 'NoteGenerateTitle' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'NoteGenerateInstructions' })).toBeDisabled();
    expect(screen.getAllByText('NoteSuggestionLimit')).toHaveLength(2);
    expect(api.suggest).not.toHaveBeenCalled();
  }
);

test.unit.stable(
  'offers retry guidance for invalid model output',
  async ({ waitFor, expect, screen, fireEvent, render }) => {
    api.suggest.mockRejectedValue(new StudyError('transient', 'Invalid transform suggestion'));
    mount({ render });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'NoteGenerateTitle' })).toBeEnabled()
    );
    fireEvent.click(screen.getByRole('button', { name: 'NoteGenerateTitle' }));
    expect(await screen.findByText('NoteSuggestionError')).toBeVisible();
    expect(screen.queryByText('NoteSuggestionContextError')).toBeNull();
  }
);

test.unit.stable(
  'blocks new suggestions and page creation when setup is missing',
  async ({ expect, screen, waitFor, fireEvent, render }) => {
    api.readiness = 'setup';
    mount({ render });
    expect(screen.getAllByText('Readiness: setup')).toHaveLength(1);
    await waitFor(() => expect(screen.getByLabelText('NoteOutputTitle')).toBeEnabled());
    fireEvent.change(screen.getByLabelText('NoteOutputTitle'), {
      target: { value: 'Title' }
    });
    expect(screen.getByRole('button', { name: 'NoteGenerateTitle' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'NoteCreatePage' })).toBeDisabled();
    expect(api.suggest).not.toHaveBeenCalled();
  }
);
