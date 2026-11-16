import { StudyError, noteIdSchema } from '@study/contracts';
import { test } from '@study/testing';
import type * as Router from '@tanstack/react-router';
import { Schema } from 'effect';
import { AtomRegistry } from 'effect/reactivity';
import { useMemo } from 'react';
import type { ReactNode } from 'react';

let useAiReadiness: typeof __MockType0.useAiReadiness;

let Composer: typeof __MockType1.Composer;

let composerDraft: typeof __MockType2.composerDraft;

import type * as __MockType0 from '#client/lib/ai-readiness.ts';

import type * as __MockType1 from './composer';
import type * as __MockType2 from './composer.queries';
import type * as NoteQueries from './note-workspace.queries';
import type * as __MockType3 from './note-workspace.queries';
import type * as __MockType4 from './transformation';
import type * as __MockType5 from './unavailable-attempt';

let ask: typeof __MockType3.ask;

let captureContext: typeof __MockType3.captureContext;

let transformPage: typeof __MockType3.transformPage;

let uploadSource: typeof __MockType3.uploadSource;

let saveNote: typeof __MockType3.saveNote;

let Transformation: typeof __MockType4.Transformation;

let UnavailableAttempt: typeof __MockType5.UnavailableAttempt;

let reads: ReturnType<typeof createMockState>['reads'];

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });

  return { promise, resolve };
}

const id = Schema.decodeUnknownSync(noteIdSchema)(501n);

const clients: AtomRegistry.AtomRegistry[] = [];

function RecoveryProvider({
  registry,
  children,
  rpcTestTransport
}: {
  registry: AtomRegistry.AtomRegistry;
  children: ReactNode;
  rpcTestTransport: Pick<test.Context, 'rpcTestTransport'>['rpcTestTransport'];
}) {
  const fixture = useMemo(
    () =>
      rpcTestTransport(async (tag, input) => {
        if (tag === 'notes.noteSelection') return reads.selection();

        if (tag === 'notes.thread') return reads.thread();

        if (tag === 'notes.noteGenerations') return reads.runs();

        if (tag === 'notes.note') {
          const { id: noteId } = Schema.decodeUnknownSync(Schema.Struct({ id: noteIdSchema }))(
            input
          );

          return {
            id: noteId,
            title: 'Note',
            titleSource: 'user',
            projectIds: [],
            archivedAt: null,
            createdAt: 1n,
            updatedAt: 1n
          };
        }

        throw new StudyError('unsupported', tag);
      }, registry),
    [registry, rpcTestTransport]
  );

  return <fixture.wrapper>{children}</fixture.wrapper>;
}

function mount(
  { render, rpcTestTransport }: Pick<test.Context, 'render' | 'rpcTestTransport'>,
  node: ReactNode,
  client = AtomRegistry.make()
) {
  if (!clients.includes(client)) clients.push(client);

  return {
    client,
    ...render(
      <RecoveryProvider registry={client} rpcTestTransport={rpcTestTransport}>
        {node}
      </RecoveryProvider>
    )
  };
}

function createMockState(mock: test.Mock) {
  return {
    reads: (() => ({
      selection: mock.fn(),
      thread: mock.fn(),
      runs: mock.fn()
    }))()
  };
}

test.beforeEach(async ({ mock }) => {
  const __mockState = createMockState(mock);

  reads = __mockState.reads;

  mock('@tanstack/react-router', async (load) => ({
    ...(await load<typeof Router>()),
    Link: ({ to, children }: { to: string; children?: ReactNode }) => <a href={to}>{children}</a>
  }));
  mock('#client/lib/i18n.tsx', () => ({
    useI18n: () => ({ t: (key: string) => key, locale: 'english' })
  }));
  mock('#client/features/note-workspace/history', () => ({ CapturedContext: () => null }));
  mock('#client/features/note-workspace/note-workspace.queries', async (load) => ({
    ...(await load<typeof NoteQueries>()),
    ask: mock.fn(),
    saveNote: mock.fn(),
    captureContext: mock.fn(),
    transformPage: mock.fn(),
    uploadSource: mock.fn()
  }));
  mock('#client/lib/ai-readiness.ts', () => ({ useAiReadiness: mock.fn(() => 'ready') }));
  const __mockModule0 = await import('#client/lib/ai-readiness.ts');

  useAiReadiness = __mockModule0.useAiReadiness;
  const __mockModule1 = await import('./composer');

  Composer = __mockModule1.Composer;
  const __mockModule2 = await import('./composer.queries');

  composerDraft = __mockModule2.composerDraft;
  const __mockModule3 = await import('./note-workspace.queries');

  ask = __mockModule3.ask;
  captureContext = __mockModule3.captureContext;
  transformPage = __mockModule3.transformPage;
  uploadSource = __mockModule3.uploadSource;
  saveNote = __mockModule3.saveNote;
  const __mockModule4 = await import('./transformation');

  Transformation = __mockModule4.Transformation;
  const __mockModule5 = await import('./unavailable-attempt');

  UnavailableAttempt = __mockModule5.UnavailableAttempt;
});

test.beforeEach(({ vi }) => {
  vi.resetAllMocks();
  vi.mocked(useAiReadiness).mockReturnValue('ready');
  reads.selection.mockResolvedValue({ revision: 8n, targets: [] });
  reads.thread.mockResolvedValue({ items: [], next: null });
  reads.runs.mockResolvedValue({ items: [], next: null });
});
test.afterEach(({ cleanup }) => {
  cleanup();
  clients.splice(0).forEach((client) => client.dispose());
});

test.stable.for(['selection', 'thread', 'runs'] as const)(
  'requires successful %s reconciliation and loses review authorization on remount',
  async (failedRead, { vi, fireEvent, screen, expect, render, rpcTestTransport }) => {
    const abandon = vi.fn();

    reads[failedRead].mockRejectedValueOnce(new StudyError('not_found', 'Unavailable'));
    const node = <UnavailableAttempt id={id} busy={false} onAbandon={abandon} />;
    const first = mount({ render, rpcTestTransport }, node);

    fireEvent.click(screen.getByRole('button', { name: 'NoteReviewUnavailableAttempt' }));
    await screen.findByRole('alert');
    expect(screen.queryByRole('button', { name: 'NoteAbandonAttempt' })).toBeNull();
    expect(abandon).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'NoteReviewUnavailableAttempt' }));
    await screen.findByRole('button', { name: 'NoteAbandonAttempt' });
    expect(reads.selection).toHaveBeenCalledTimes(2);
    expect(reads.thread).toHaveBeenCalledTimes(2);
    expect(reads.runs).toHaveBeenCalledTimes(2);
    expect(abandon).not.toHaveBeenCalled();
    first.unmount();
    const reopened = mount({ render, rpcTestTransport }, node, first.client);

    expect(screen.queryByRole('button', { name: 'NoteAbandonAttempt' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'NoteReviewUnavailableAttempt' }));
    await screen.findByRole('button', { name: 'NoteAbandonAttempt' });
    reopened.rerender(
      <RecoveryProvider registry={first.client} rpcTestTransport={rpcTestTransport}>
        <UnavailableAttempt id={id} busy onAbandon={abandon} />
      </RecoveryProvider>
    );
    fireEvent.click(screen.getByRole('button', { name: 'NoteAbandonAttempt' }));
    expect(abandon).not.toHaveBeenCalled();
    reopened.rerender(
      <RecoveryProvider registry={first.client} rpcTestTransport={rpcTestTransport}>
        {node}
      </RecoveryProvider>
    );
    fireEvent.click(screen.getByRole('button', { name: 'NoteAbandonAttempt' }));
    expect(abandon).toHaveBeenCalledTimes(1);
    expect(ask).not.toHaveBeenCalled();
    expect(captureContext).not.toHaveBeenCalled();
  }
);

test.stable(
  'abandons a retained unavailable Ask after review and resumes plain capture with its attachments',
  async ({ vi, fireEvent, screen, act, expect, waitFor, render, rpcTestTransport }) => {
    vi.mocked(uploadSource).mockResolvedValue({ id: 44n } as Awaited<
      ReturnType<typeof uploadSource>
    >);
    vi.mocked(saveNote).mockResolvedValue({} as Awaited<ReturnType<typeof saveNote>>);
    const first = mount({ render, rpcTestTransport }, <Composer id={id} />);

    fireEvent.change(screen.getByLabelText('NoteAttachFiles'), {
      target: { files: [new File(['notes'], 'retained.txt')] }
    });
    await screen.findByText('NoteFileAccepted');
    act(() =>
      first.client.set(composerDraft(id), {
        text: 'Later draft',
        instruction: '',
        askUnavailable: true,
        askAttempt: {
          noteId: id,
          intentKey: 'retired-ask',
          expectedSelectionRevision: 8n,
          text: 'Original question'
        }
      })
    );
    await screen.findByRole('button', { name: 'NoteReviewUnavailableAttempt' });
    first.unmount();
    mount({ render, rpcTestTransport }, <Composer id={id} />, first.client);
    expect(screen.queryByRole('button', { name: 'NoteAsk' })).toBeNull();
    expect(screen.getByRole('button', { name: 'NoteSaveNote' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'NoteRetryAsk' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'NoteReviewUnavailableAttempt' }));
    fireEvent.click(await screen.findByRole('button', { name: 'NoteAbandonAttempt' }));
    expect(screen.getByRole('textbox')).toHaveValue('Later draft');
    expect(screen.getByText('retained.txt')).toBeVisible();
    await waitFor(() => expect(screen.getByRole('button', { name: 'NoteSaveNote' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'NoteSaveNote' }));
    await waitFor(() => expect(saveNote).toHaveBeenCalledExactlyOnceWith(id, 'Later draft', [44n]));
    expect(ask).not.toHaveBeenCalled();
    expect(uploadSource).toHaveBeenCalledTimes(1);
  }
);

test.stable(
  'retains transform pending ownership and immutable retry inputs across remount and edited fields',
  async ({ vi, fireEvent, screen, waitFor, expect, act, render, rpcTestTransport }) => {
    const capture = deferred<Awaited<ReturnType<typeof captureContext>>>();
    const onStarted = vi.fn();

    vi.mocked(captureContext)
      .mockReturnValueOnce(capture.promise)
      .mockRejectedValueOnce(new StudyError('not_found', 'Retired capture'));
    vi.mocked(transformPage).mockRejectedValueOnce(new StudyError('transient', 'Lost receipt'));
    const first = mount(
      { render, rpcTestTransport },
      <Transformation id={id} onStarted={onStarted} />
    );

    fireEvent.change(screen.getByLabelText('NoteOutputTitle'), {
      target: { value: 'Original title' }
    });
    fireEvent.change(screen.getByLabelText('NoteInstructions'), {
      target: { value: 'Original instruction' }
    });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'NoteCreatePage' })).toBeEnabled()
    );
    fireEvent.click(screen.getByRole('button', { name: 'NoteCreatePage' }));
    expect(onStarted).toHaveBeenCalledExactlyOnceWith();
    await waitFor(() => expect(captureContext).toHaveBeenCalledTimes(1));
    const submitted = vi.mocked(captureContext).mock.calls[0]![0];

    first.unmount();
    const second = mount({ render, rpcTestTransport }, <Transformation id={id} />, first.client);

    expect(screen.getByRole('button', { name: 'NoteCreatePage' })).toBeDisabled();
    expect(captureContext).toHaveBeenCalledTimes(1);
    fireEvent.change(screen.getByLabelText('NoteOutputTitle'), {
      target: { value: 'Later title' }
    });
    fireEvent.change(screen.getByLabelText('NoteInstructions'), {
      target: { value: 'Later instruction' }
    });
    fireEvent.click(screen.getByText('PageAdvancedOptions'));
    fireEvent.click(screen.getByRole('button', { name: 'NoteOpGrammar' }));
    await act(async () => {
      capture.resolve({ requestId: 'capture-1', selectionRevision: 8n } as Awaited<
        ReturnType<typeof captureContext>
      >);
      await capture.promise;
    });
    await screen.findByRole('button', { name: 'Retry' });
    expect(transformPage).toHaveBeenCalledWith({
      contextRequestId: 'capture-1',
      title: 'Original title',
      operations: ['clarity']
    });
    second.unmount();
    vi.mocked(useAiReadiness).mockReturnValue('setup');
    const unavailable = mount(
      { render, rpcTestTransport },
      <Transformation id={id} />,
      first.client
    );

    expect(screen.getByRole('button', { name: 'Retry' })).toBeDisabled();
    fireEvent.click(await screen.findByRole('button', { name: 'Retry' }));
    expect(captureContext).toHaveBeenCalledTimes(1);
    unavailable.unmount();
    vi.mocked(useAiReadiness).mockReturnValue('ready');
    const third = mount({ render, rpcTestTransport }, <Transformation id={id} />, first.client);

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await screen.findByRole('button', { name: 'NoteReviewUnavailableAttempt' });
    expect(vi.mocked(captureContext).mock.calls[1]![0]).toEqual(submitted);
    expect(transformPage).toHaveBeenCalledTimes(1);
    third.unmount();
    mount({ render, rpcTestTransport }, <Transformation id={id} />, first.client);
    fireEvent.click(screen.getByRole('button', { name: 'NoteReviewUnavailableAttempt' }));
    fireEvent.click(await screen.findByRole('button', { name: 'NoteAbandonAttempt' }));
    expect(screen.getByLabelText('NoteOutputTitle')).toHaveValue('Later title');
    expect(screen.getByLabelText('NoteInstructions')).toHaveValue('Later instruction');
    expect(screen.getByRole('button', { name: 'NoteOpGrammar' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    expect(captureContext).toHaveBeenCalledTimes(2);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'NoteCreatePage' })).toBeEnabled()
    );
    vi.mocked(captureContext).mockResolvedValueOnce({
      requestId: 'capture-2',
      selectionRevision: 8n
    } as Awaited<ReturnType<typeof captureContext>>);
    vi.mocked(transformPage).mockRejectedValueOnce(
      new StudyError('transient', 'Unconfirmed new result')
    );
    fireEvent.click(screen.getByRole('button', { name: 'NoteCreatePage' }));
    await waitFor(() => expect(transformPage).toHaveBeenCalledTimes(2));
    expect(vi.mocked(captureContext).mock.calls[2]![0]).toMatchObject({
      instruction: 'Later instruction'
    });
    expect(vi.mocked(captureContext).mock.calls[2]![0].intentKey).not.toBe(submitted.intentKey);
    expect(vi.mocked(transformPage).mock.calls[1]![0]).toEqual({
      contextRequestId: 'capture-2',
      title: 'Later title',
      operations: ['clarity', 'grammar']
    });
    await screen.findByRole('alert');
  }
);

test.stable(
  'does not authorize abandonment until all reconciliation reads have completed',
  async ({ vi, fireEvent, screen, waitFor, expect, act, render, rpcTestTransport }) => {
    const runs = deferred<{ items: never[]; next: null }>();

    reads.runs.mockReturnValue(runs.promise);
    const abandon = vi.fn();

    mount(
      { render, rpcTestTransport },
      <UnavailableAttempt id={id} busy={false} onAbandon={abandon} />
    );
    fireEvent.click(screen.getByRole('button', { name: 'NoteReviewUnavailableAttempt' }));
    await waitFor(() => expect(reads.thread).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('button', { name: 'NoteReviewUnavailableAttempt' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'NoteAbandonAttempt' })).toBeNull();
    await act(async () => {
      runs.resolve({ items: [], next: null });
      await runs.promise;
    });
    await screen.findByRole('button', { name: 'NoteAbandonAttempt' });
    expect(abandon).not.toHaveBeenCalled();
  }
);

test.stable(
  'combines externally selected notes into one immutable document attempt with optional instructions',
  async ({ vi, fireEvent, screen, waitFor, expect, render, rpcTestTransport }) => {
    vi.mocked(captureContext).mockRejectedValue(new StudyError('transient', 'Retry later'));
    const view = mount(
      { render, rpcTestTransport },
      <Transformation
        id={id}
        notes={[
          { id, title: 'First' },
          { id: Schema.decodeUnknownSync(noteIdSchema)(502n), title: 'Second lecture' }
        ]}
      />
    );

    fireEvent.change(screen.getByLabelText('NoteOutputTitle'), {
      target: { value: 'Course notes' }
    });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'NoteCreatePage' })).toBeEnabled()
    );
    fireEvent.click(screen.getByRole('button', { name: 'NoteCreatePage' }));
    await waitFor(() => expect(captureContext).toHaveBeenCalled());
    expect(vi.mocked(captureContext).mock.calls[0]![0]).toMatchObject({
      noteId: id,
      additionalNoteIds: [502n],
      instruction: '',
      preferences: { language: 'english' }
    });
    view.rerender(
      <RecoveryProvider registry={view.client} rpcTestTransport={rpcTestTransport}>
        <Transformation
          id={id}
          notes={[
            { id, title: 'First renamed' },
            {
              id: Schema.decodeUnknownSync(noteIdSchema)(502n),
              title: 'Second lecture renamed'
            }
          ]}
        />
      </RecoveryProvider>
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(captureContext).toHaveBeenCalledTimes(2));
    expect(vi.mocked(captureContext).mock.calls[1]![0]).toEqual(
      vi.mocked(captureContext).mock.calls[0]![0]
    );
  }
);

test.stable(
  'keeps document recovery separate for different selected groups with the same first note',
  async ({ vi, fireEvent, screen, waitFor, expect, render, rpcTestTransport }) => {
    vi.mocked(captureContext).mockRejectedValue(new StudyError('transient', 'Retry later'));
    const other = Schema.decodeUnknownSync(noteIdSchema)(502n);
    const third = Schema.decodeUnknownSync(noteIdSchema)(503n);
    const first = mount(
      { render, rpcTestTransport },
      <Transformation
        id={id}
        notes={[
          { id, title: 'First' },
          { id: other, title: 'Second' }
        ]}
      />
    );

    fireEvent.change(screen.getByLabelText('NoteOutputTitle'), {
      target: { value: 'First group' }
    });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'NoteCreatePage' })).toBeEnabled()
    );
    fireEvent.click(screen.getByRole('button', { name: 'NoteCreatePage' }));
    await screen.findByRole('button', { name: 'Retry' });
    first.unmount();
    const second = mount(
      { render, rpcTestTransport },
      <Transformation
        id={id}
        notes={[
          { id, title: 'First' },
          { id: third, title: 'Third' }
        ]}
      />,
      first.client
    );

    expect(screen.getByLabelText('NoteOutputTitle')).toHaveValue('');
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    fireEvent.change(screen.getByLabelText('NoteOutputTitle'), {
      target: { value: 'Second group' }
    });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'NoteCreatePage' })).toBeEnabled()
    );
    fireEvent.click(screen.getByRole('button', { name: 'NoteCreatePage' }));
    await waitFor(() => expect(captureContext).toHaveBeenCalledTimes(2));
    expect(vi.mocked(captureContext).mock.calls[1]![0].additionalNoteIds).toEqual([third]);
    second.unmount();
    mount(
      { render, rpcTestTransport },
      <Transformation
        id={id}
        notes={[
          { id, title: 'First' },
          { id: other, title: 'Second' }
        ]}
      />,
      first.client
    );
    expect(screen.getByLabelText('NoteOutputTitle')).toHaveValue('First group');
    fireEvent.click(await screen.findByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(captureContext).toHaveBeenCalledTimes(3));
    expect(vi.mocked(captureContext).mock.calls[2]![0]).toEqual(
      vi.mocked(captureContext).mock.calls[0]![0]
    );
  }
);
