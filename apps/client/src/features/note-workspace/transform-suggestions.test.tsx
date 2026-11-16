import { StudyError, noteIdSchema } from '@study/contracts';
import { test } from '@study/testing';
import { Schema } from 'effect';

import type * as __MockType0 from './transformation';

let Transformation: typeof __MockType0.Transformation;

let api: ReturnType<typeof createMockState>['api'];

const id = noteIdSchema.make(1n);

let fixture: ReturnType<test.Context['rpcTestTransport']>;

let revision = 1n;

function Provider({ children }: { children: React.ReactNode }) {
  return <fixture.wrapper>{children}</fixture.wrapper>;
}

function createMockState(mock: test.Mock) {
  return {
    api: (() => ({ suggest: mock.fn(), readiness: 'ready' as string }))()
  };
}

test.beforeEach(async ({ mock }) => {
  const __mockState = createMockState(mock);

  api = __mockState.api;

  mock('#client/lib/ai-readiness.ts', () => ({ useAiReadiness: () => api.readiness }));
  mock('#client/lib/ai-readiness-notice.tsx', () => ({
    AiReadinessNotice: ({ state }: { state: string }) =>
      state === 'ready' ? null : <p>Readiness: {state}</p>
  }));
  mock('#client/lib/i18n.tsx', () => ({
    useI18n: () => ({ t: (key: string) => key, locale: 'english' })
  }));
  mock('#client/features/note-workspace/history', () => ({ CapturedContext: () => null }));
  const __mockModule0 = await import('./transformation');

  Transformation = __mockModule0.Transformation;
});

test.beforeEach(({ vi, rpcTestTransport }) => {
  vi.resetAllMocks();
  api.readiness = 'ready';
  revision = 1n;
  fixture = rpcTestTransport(async (tag, input) => {
    if (tag === 'notes.suggestTransformField') return api.suggest(input);

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

    throw new StudyError('unsupported', tag);
  });
});
test.afterEach(({ cleanup }) => {
  cleanup();
});

function mount({ render }: Pick<test.Context, 'render'>, active = true) {
  return render(
    <Provider>
      <Transformation id={id} active={active} />
    </Provider>
  );
}

function deferred() {
  let resolve!: (value: string) => void;
  const promise = new Promise<string>((accept) => {
    resolve = accept;
  });

  return { promise, resolve };
}

test.stable(
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

test.stable(
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

test.stable(
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

test.stable(
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

test.stable(
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

test.stable(
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

test.stable(
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
