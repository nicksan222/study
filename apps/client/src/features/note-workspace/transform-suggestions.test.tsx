import { StudyError, noteIdSchema } from '@study/contracts';
import { test } from '@study/testing';
import { Schema } from 'effect';

import type * as __MockType0 from './transformation';

let Transformation: typeof __MockType0.Transformation;

let api: ReturnType<typeof createMockState>['api'];

const id = noteIdSchema.make(1n);

let fixture: ReturnType<typeof test.rpcTestTransport>;

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

test.beforeEach(() => {
  test.vi.resetAllMocks();
  api.readiness = 'ready';
  revision = 1n;
  fixture = test.rpcTestTransport(async (tag, input) => {
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
test.afterEach(() => {
  test.cleanup();
});

function mount(active = true) {
  return test.render(
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
  async () => {
    const title = deferred();

    api.suggest.mockImplementation(({ field }: { field: string }) =>
      field === 'title' ? title.promise : Promise.resolve('Explain cell division')
    );
    mount();
    await test.waitFor(() =>
      test.expect(test.screen.getByRole('button', { name: 'NoteGenerateTitle' })).toBeEnabled()
    );
    test.fireEvent.click(test.screen.getByRole('button', { name: 'NoteGenerateTitle' }));
    await test.waitFor(() => test.expect(api.suggest).toHaveBeenCalledTimes(1));
    test.expect(test.screen.getByRole('button', { name: 'NoteGenerateTitle' })).toBeDisabled();
    test.fireEvent.click(test.screen.getByRole('button', { name: 'NoteGenerateInstructions' }));
    await test.waitFor(() =>
      test
        .expect(test.screen.getByLabelText('NoteInstructions'))
        .toHaveValue('Explain cell division')
    );
    test.fireEvent.change(test.screen.getByLabelText('NoteOutputTitle'), {
      target: { value: 'My title' }
    });
    await test.waitFor(() =>
      test.expect(test.screen.getByLabelText('NoteOutputTitle')).toHaveValue('My title')
    );
    await test.act(async () => title.resolve('Generated title'));
    test.expect(test.screen.getByLabelText('NoteOutputTitle')).toHaveValue('My title');
    test
      .expect(api.suggest)
      .toHaveBeenCalledWith(
        test.expect.objectContaining({ noteId: id, field: 'instruction', language: 'english' })
      );
  }
);

test.stable('ignores old results after dismiss and reopen even when kept mounted', async () => {
  const title = deferred();

  api.suggest.mockReturnValue(title.promise);
  const view = mount();

  await test.waitFor(() =>
    test.expect(test.screen.getByRole('button', { name: 'NoteGenerateTitle' })).toBeEnabled()
  );
  test.fireEvent.click(test.screen.getByRole('button', { name: 'NoteGenerateTitle' }));
  await test.waitFor(() => test.expect(api.suggest).toHaveBeenCalledTimes(1));
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
  await test.act(async () => title.resolve('Old title'));
  test.expect(test.screen.getByLabelText('NoteOutputTitle')).toHaveValue('');
});

test.stable('shows a field error without clearing the other field and allows retry', async () => {
  api.suggest
    .mockRejectedValueOnce(new StudyError('auth', 'Sign in'))
    .mockResolvedValue('Cell biology');
  mount();
  await test.waitFor(() =>
    test.expect(test.screen.getByRole('button', { name: 'NoteGenerateTitle' })).toBeEnabled()
  );
  test.fireEvent.click(test.screen.getByRole('button', { name: 'NoteGenerateTitle' }));
  await test.screen.findByRole('alert');
  test.expect(test.screen.getByLabelText('NoteInstructions')).toHaveValue('');
  test.fireEvent.click(test.screen.getByRole('button', { name: 'NoteGenerateTitle' }));
  await test.waitFor(() =>
    test.expect(test.screen.getByLabelText('NoteOutputTitle')).toHaveValue('Cell biology')
  );
});

test.stable(
  'ignores results after saved context changes or the selected notes change',
  async () => {
    const title = deferred();

    api.suggest.mockReturnValue(title.promise);
    const view = mount();

    await test.waitFor(() =>
      test.expect(test.screen.getByRole('button', { name: 'NoteGenerateTitle' })).toBeEnabled()
    );
    test.fireEvent.click(test.screen.getByRole('button', { name: 'NoteGenerateTitle' }));
    await test.waitFor(() => test.expect(api.suggest).toHaveBeenCalledTimes(1));
    revision = 2n;
    await test.act(async () => {
      await fixture.notify();
    });
    await test.waitFor(() =>
      test.expect(test.screen.getByRole('button', { name: 'NoteGenerateTitle' })).toBeEnabled()
    );
    await test.act(async () => title.resolve('Stale title'));
    test.expect(test.screen.getByLabelText('NoteOutputTitle')).toHaveValue('');
    const next = deferred();

    api.suggest.mockReturnValue(next.promise);
    test.fireEvent.click(test.screen.getByRole('button', { name: 'NoteGenerateTitle' }));
    await test.waitFor(() => test.expect(api.suggest).toHaveBeenCalledTimes(2));
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
    await test.act(async () => next.resolve('Wrong group'));
    test.expect(test.screen.getByLabelText('NoteOutputTitle')).toHaveValue('');
  }
);

test.stable('disables suggestions above twenty notes without truncating the selection', () => {
  test.render(
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
  test.expect(test.screen.getByRole('button', { name: 'NoteGenerateTitle' })).toBeDisabled();
  test.expect(test.screen.getByRole('button', { name: 'NoteGenerateInstructions' })).toBeDisabled();
  test.expect(test.screen.getAllByText('NoteSuggestionLimit')).toHaveLength(2);
  test.expect(api.suggest).not.toHaveBeenCalled();
});

test.stable('offers retry guidance for invalid model output', async () => {
  api.suggest.mockRejectedValue(new StudyError('transient', 'Invalid transform suggestion'));
  mount();
  await test.waitFor(() =>
    test.expect(test.screen.getByRole('button', { name: 'NoteGenerateTitle' })).toBeEnabled()
  );
  test.fireEvent.click(test.screen.getByRole('button', { name: 'NoteGenerateTitle' }));
  test.expect(await test.screen.findByText('NoteSuggestionError')).toBeVisible();
  test.expect(test.screen.queryByText('NoteSuggestionContextError')).toBeNull();
});

test.stable('blocks new suggestions and page creation when setup is missing', async () => {
  api.readiness = 'setup';
  mount();
  test.expect(test.screen.getAllByText('Readiness: setup')).toHaveLength(1);
  await test.waitFor(() =>
    test.expect(test.screen.getByLabelText('NoteOutputTitle')).toBeEnabled()
  );
  test.fireEvent.change(test.screen.getByLabelText('NoteOutputTitle'), {
    target: { value: 'Title' }
  });
  test.expect(test.screen.getByRole('button', { name: 'NoteGenerateTitle' })).toBeDisabled();
  test.expect(test.screen.getByRole('button', { name: 'NoteCreatePage' })).toBeDisabled();
  test.expect(api.suggest).not.toHaveBeenCalled();
});
