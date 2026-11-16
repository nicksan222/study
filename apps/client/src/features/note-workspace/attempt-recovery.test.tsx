import { StudyError, noteIdSchema } from '@study/contracts';
import { test } from '@study/testing';
import type * as Router from '@tanstack/react-router';
import { Schema } from 'effect';
import { AtomRegistry } from 'effect/reactivity';
import { useMemo } from 'react';
import type { ReactNode } from 'react';

import { useAiReadiness } from '#client/lib/ai-readiness.ts';

import { Composer } from './composer';
import { composerDraft } from './composer.queries';
import type * as NoteQueries from './note-workspace.queries';
import {
  ask,
  captureContext,
  transformPage,
  uploadSource,
  saveNote
} from './note-workspace.queries';
import { Transformation } from './transformation';
import { UnavailableAttempt } from './unavailable-attempt';

const reads = test.hoisted(() => ({
  selection: test.vi.fn(),
  thread: test.vi.fn(),
  runs: test.vi.fn()
}));

test.mock('@tanstack/react-router', async (load) => ({
  ...(await load<typeof Router>()),
  Link: ({ to, children }: { to: string; children?: ReactNode }) => <a href={to}>{children}</a>
}));

test.mock('#client/lib/i18n.tsx', () => ({
  useI18n: () => ({ t: (key: string) => key, locale: 'english' })
}));
test.mock('./history', () => ({ CapturedContext: () => null }));
test.mock('./note-workspace.queries', async (load) => ({
  ...(await load<typeof NoteQueries>()),
  ask: test.vi.fn(),
  saveNote: test.vi.fn(),
  captureContext: test.vi.fn(),
  transformPage: test.vi.fn(),
  uploadSource: test.vi.fn()
}));

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
  children
}: {
  registry: AtomRegistry.AtomRegistry;
  children: ReactNode;
}) {
  const fixture = useMemo(
    () =>
      test.rpcTestTransport(async (tag, input) => {
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
    [registry]
  );

  return <fixture.wrapper>{children}</fixture.wrapper>;
}

function mount(node: ReactNode, client = AtomRegistry.make()) {
  if (!clients.includes(client)) clients.push(client);

  return { client, ...test.render(<RecoveryProvider registry={client}>{node}</RecoveryProvider>) };
}

test.beforeEach(() => {
  test.vi.resetAllMocks();
  test.vi.mocked(useAiReadiness).mockReturnValue('ready');
  reads.selection.mockResolvedValue({ revision: 8n, targets: [] });
  reads.thread.mockResolvedValue({ items: [], next: null });
  reads.runs.mockResolvedValue({ items: [], next: null });
});
test.afterEach(() => {
  test.cleanup();
  clients.splice(0).forEach((client) => client.dispose());
});

test.stable.each(['selection', 'thread', 'runs'] as const)(
  'requires successful %s reconciliation and loses review authorization on remount',
  async (failedRead) => {
    const abandon = test.vi.fn();

    reads[failedRead].mockRejectedValueOnce(new StudyError('not_found', 'Unavailable'));
    const node = <UnavailableAttempt id={id} busy={false} onAbandon={abandon} />;
    const first = mount(node);

    test.fireEvent.click(test.screen.getByRole('button', { name: 'NoteReviewUnavailableAttempt' }));
    await test.screen.findByRole('alert');
    test.expect(test.screen.queryByRole('button', { name: 'NoteAbandonAttempt' })).toBeNull();
    test.expect(abandon).not.toHaveBeenCalled();
    test.fireEvent.click(test.screen.getByRole('button', { name: 'NoteReviewUnavailableAttempt' }));
    await test.screen.findByRole('button', { name: 'NoteAbandonAttempt' });
    test.expect(reads.selection).toHaveBeenCalledTimes(2);
    test.expect(reads.thread).toHaveBeenCalledTimes(2);
    test.expect(reads.runs).toHaveBeenCalledTimes(2);
    test.expect(abandon).not.toHaveBeenCalled();
    first.unmount();
    const reopened = mount(node, first.client);

    test.expect(test.screen.queryByRole('button', { name: 'NoteAbandonAttempt' })).toBeNull();
    test.fireEvent.click(test.screen.getByRole('button', { name: 'NoteReviewUnavailableAttempt' }));
    await test.screen.findByRole('button', { name: 'NoteAbandonAttempt' });
    reopened.rerender(
      <RecoveryProvider registry={first.client}>
        <UnavailableAttempt id={id} busy onAbandon={abandon} />
      </RecoveryProvider>
    );
    test.fireEvent.click(test.screen.getByRole('button', { name: 'NoteAbandonAttempt' }));
    test.expect(abandon).not.toHaveBeenCalled();
    reopened.rerender(<RecoveryProvider registry={first.client}>{node}</RecoveryProvider>);
    test.fireEvent.click(test.screen.getByRole('button', { name: 'NoteAbandonAttempt' }));
    test.expect(abandon).toHaveBeenCalledTimes(1);
    test.expect(ask).not.toHaveBeenCalled();
    test.expect(captureContext).not.toHaveBeenCalled();
  }
);

test.stable(
  'abandons a retained unavailable Ask after review and resumes plain capture with its attachments',
  async () => {
    test.vi
      .mocked(uploadSource)
      .mockResolvedValue({ id: 44n } as Awaited<ReturnType<typeof uploadSource>>);
    test.vi.mocked(saveNote).mockResolvedValue({} as Awaited<ReturnType<typeof saveNote>>);
    const first = mount(<Composer id={id} />);

    test.fireEvent.change(test.screen.getByLabelText('NoteAttachFiles'), {
      target: { files: [new File(['notes'], 'retained.txt')] }
    });
    await test.screen.findByText('NoteFileAccepted');
    test.act(() =>
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
    await test.screen.findByRole('button', { name: 'NoteReviewUnavailableAttempt' });
    first.unmount();
    mount(<Composer id={id} />, first.client);
    test.expect(test.screen.queryByRole('button', { name: 'NoteAsk' })).toBeNull();
    test.expect(test.screen.getByRole('button', { name: 'NoteSaveNote' })).toBeDisabled();
    test.expect(test.screen.queryByRole('button', { name: 'NoteRetryAsk' })).toBeNull();
    test.fireEvent.click(test.screen.getByRole('button', { name: 'NoteReviewUnavailableAttempt' }));
    test.fireEvent.click(await test.screen.findByRole('button', { name: 'NoteAbandonAttempt' }));
    test.expect(test.screen.getByRole('textbox')).toHaveValue('Later draft');
    test.expect(test.screen.getByText('retained.txt')).toBeVisible();
    await test.waitFor(() =>
      test.expect(test.screen.getByRole('button', { name: 'NoteSaveNote' })).toBeEnabled()
    );
    test.fireEvent.click(test.screen.getByRole('button', { name: 'NoteSaveNote' }));
    await test.waitFor(() =>
      test.expect(saveNote).toHaveBeenCalledExactlyOnceWith(id, 'Later draft', [44n])
    );
    test.expect(ask).not.toHaveBeenCalled();
    test.expect(uploadSource).toHaveBeenCalledTimes(1);
  }
);

test.stable(
  'retains transform pending ownership and immutable retry inputs across remount and edited fields',
  async () => {
    const capture = deferred<Awaited<ReturnType<typeof captureContext>>>();
    const onStarted = test.vi.fn();

    test.vi
      .mocked(captureContext)
      .mockReturnValueOnce(capture.promise)
      .mockRejectedValueOnce(new StudyError('not_found', 'Retired capture'));
    test.vi
      .mocked(transformPage)
      .mockRejectedValueOnce(new StudyError('transient', 'Lost receipt'));
    const first = mount(<Transformation id={id} onStarted={onStarted} />);

    test.fireEvent.change(test.screen.getByLabelText('NoteOutputTitle'), {
      target: { value: 'Original title' }
    });
    test.fireEvent.change(test.screen.getByLabelText('NoteInstructions'), {
      target: { value: 'Original instruction' }
    });
    await test.waitFor(() =>
      test.expect(test.screen.getByRole('button', { name: 'NoteCreatePage' })).toBeEnabled()
    );
    test.fireEvent.click(test.screen.getByRole('button', { name: 'NoteCreatePage' }));
    test.expect(onStarted).toHaveBeenCalledExactlyOnceWith();
    await test.waitFor(() => test.expect(captureContext).toHaveBeenCalledTimes(1));
    const submitted = test.vi.mocked(captureContext).mock.calls[0]![0];

    first.unmount();
    const second = mount(<Transformation id={id} />, first.client);

    test.expect(test.screen.getByRole('button', { name: 'NoteCreatePage' })).toBeDisabled();
    test.expect(captureContext).toHaveBeenCalledTimes(1);
    test.fireEvent.change(test.screen.getByLabelText('NoteOutputTitle'), {
      target: { value: 'Later title' }
    });
    test.fireEvent.change(test.screen.getByLabelText('NoteInstructions'), {
      target: { value: 'Later instruction' }
    });
    test.fireEvent.click(test.screen.getByText('PageAdvancedOptions'));
    test.fireEvent.click(test.screen.getByRole('button', { name: 'NoteOpGrammar' }));
    await test.act(async () => {
      capture.resolve({ requestId: 'capture-1', selectionRevision: 8n } as Awaited<
        ReturnType<typeof captureContext>
      >);
      await capture.promise;
    });
    await test.screen.findByRole('button', { name: 'Retry' });
    test.expect(transformPage).toHaveBeenCalledWith({
      contextRequestId: 'capture-1',
      title: 'Original title',
      operations: ['clarity']
    });
    second.unmount();
    test.vi.mocked(useAiReadiness).mockReturnValue('setup');
    const unavailable = mount(<Transformation id={id} />, first.client);

    test.expect(test.screen.getByRole('button', { name: 'Retry' })).toBeDisabled();
    test.fireEvent.click(test.screen.getByRole('button', { name: 'Retry' }));
    test.expect(captureContext).toHaveBeenCalledTimes(1);
    unavailable.unmount();
    test.vi.mocked(useAiReadiness).mockReturnValue('ready');
    const third = mount(<Transformation id={id} />, first.client);

    test.fireEvent.click(test.screen.getByRole('button', { name: 'Retry' }));
    await test.screen.findByRole('button', { name: 'NoteReviewUnavailableAttempt' });
    test.expect(test.vi.mocked(captureContext).mock.calls[1]![0]).toEqual(submitted);
    test.expect(transformPage).toHaveBeenCalledTimes(1);
    third.unmount();
    mount(<Transformation id={id} />, first.client);
    test.fireEvent.click(test.screen.getByRole('button', { name: 'NoteReviewUnavailableAttempt' }));
    test.fireEvent.click(await test.screen.findByRole('button', { name: 'NoteAbandonAttempt' }));
    test.expect(test.screen.getByLabelText('NoteOutputTitle')).toHaveValue('Later title');
    test.expect(test.screen.getByLabelText('NoteInstructions')).toHaveValue('Later instruction');
    test
      .expect(test.screen.getByRole('button', { name: 'NoteOpGrammar' }))
      .toHaveAttribute('aria-pressed', 'true');
    test.expect(captureContext).toHaveBeenCalledTimes(2);
    await test.waitFor(() =>
      test.expect(test.screen.getByRole('button', { name: 'NoteCreatePage' })).toBeEnabled()
    );
    test.vi.mocked(captureContext).mockResolvedValueOnce({
      requestId: 'capture-2',
      selectionRevision: 8n
    } as Awaited<ReturnType<typeof captureContext>>);
    test.vi
      .mocked(transformPage)
      .mockRejectedValueOnce(new StudyError('transient', 'Unconfirmed new result'));
    test.fireEvent.click(test.screen.getByRole('button', { name: 'NoteCreatePage' }));
    await test.waitFor(() => test.expect(transformPage).toHaveBeenCalledTimes(2));
    test.expect(test.vi.mocked(captureContext).mock.calls[2]![0]).toMatchObject({
      instruction: 'Later instruction'
    });
    test
      .expect(test.vi.mocked(captureContext).mock.calls[2]![0].intentKey)
      .not.toBe(submitted.intentKey);
    test.expect(test.vi.mocked(transformPage).mock.calls[1]![0]).toEqual({
      contextRequestId: 'capture-2',
      title: 'Later title',
      operations: ['clarity', 'grammar']
    });
    await test.screen.findByRole('alert');
  }
);

test.stable(
  'does not authorize abandonment until all reconciliation reads have completed',
  async () => {
    const runs = deferred<{ items: never[]; next: null }>();

    reads.runs.mockReturnValue(runs.promise);
    const abandon = test.vi.fn();

    mount(<UnavailableAttempt id={id} busy={false} onAbandon={abandon} />);
    test.fireEvent.click(test.screen.getByRole('button', { name: 'NoteReviewUnavailableAttempt' }));
    await test.waitFor(() => test.expect(reads.thread).toHaveBeenCalledTimes(1));
    test
      .expect(test.screen.getByRole('button', { name: 'NoteReviewUnavailableAttempt' }))
      .toBeDisabled();
    test.expect(test.screen.queryByRole('button', { name: 'NoteAbandonAttempt' })).toBeNull();
    await test.act(async () => {
      runs.resolve({ items: [], next: null });
      await runs.promise;
    });
    await test.screen.findByRole('button', { name: 'NoteAbandonAttempt' });
    test.expect(abandon).not.toHaveBeenCalled();
  }
);

test.stable(
  'combines externally selected notes into one immutable document attempt with optional instructions',
  async () => {
    test.vi.mocked(captureContext).mockRejectedValue(new StudyError('transient', 'Retry later'));
    const view = mount(
      <Transformation
        id={id}
        notes={[
          { id, title: 'First' },
          { id: Schema.decodeUnknownSync(noteIdSchema)(502n), title: 'Second lecture' }
        ]}
      />
    );

    test.fireEvent.change(test.screen.getByLabelText('NoteOutputTitle'), {
      target: { value: 'Course notes' }
    });
    await test.waitFor(() =>
      test.expect(test.screen.getByRole('button', { name: 'NoteCreatePage' })).toBeEnabled()
    );
    test.fireEvent.click(test.screen.getByRole('button', { name: 'NoteCreatePage' }));
    await test.waitFor(() => test.expect(captureContext).toHaveBeenCalled());
    test.expect(test.vi.mocked(captureContext).mock.calls[0]![0]).toMatchObject({
      noteId: id,
      additionalNoteIds: [502n],
      instruction: '',
      preferences: { language: 'english' }
    });
    view.rerender(
      <RecoveryProvider registry={view.client}>
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
    test.fireEvent.click(test.screen.getByRole('button', { name: 'Retry' }));
    await test.waitFor(() => test.expect(captureContext).toHaveBeenCalledTimes(2));
    test
      .expect(test.vi.mocked(captureContext).mock.calls[1]![0])
      .toEqual(test.vi.mocked(captureContext).mock.calls[0]![0]);
  }
);

test.stable(
  'keeps document recovery separate for different selected groups with the same first note',
  async () => {
    test.vi.mocked(captureContext).mockRejectedValue(new StudyError('transient', 'Retry later'));
    const other = Schema.decodeUnknownSync(noteIdSchema)(502n);
    const third = Schema.decodeUnknownSync(noteIdSchema)(503n);
    const first = mount(
      <Transformation
        id={id}
        notes={[
          { id, title: 'First' },
          { id: other, title: 'Second' }
        ]}
      />
    );

    test.fireEvent.change(test.screen.getByLabelText('NoteOutputTitle'), {
      target: { value: 'First group' }
    });
    await test.waitFor(() =>
      test.expect(test.screen.getByRole('button', { name: 'NoteCreatePage' })).toBeEnabled()
    );
    test.fireEvent.click(test.screen.getByRole('button', { name: 'NoteCreatePage' }));
    await test.screen.findByRole('button', { name: 'Retry' });
    first.unmount();
    const second = mount(
      <Transformation
        id={id}
        notes={[
          { id, title: 'First' },
          { id: third, title: 'Third' }
        ]}
      />,
      first.client
    );

    test.expect(test.screen.getByLabelText('NoteOutputTitle')).toHaveValue('');
    test.expect(test.screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    test.fireEvent.change(test.screen.getByLabelText('NoteOutputTitle'), {
      target: { value: 'Second group' }
    });
    await test.waitFor(() =>
      test.expect(test.screen.getByRole('button', { name: 'NoteCreatePage' })).toBeEnabled()
    );
    test.fireEvent.click(test.screen.getByRole('button', { name: 'NoteCreatePage' }));
    await test.waitFor(() => test.expect(captureContext).toHaveBeenCalledTimes(2));
    test
      .expect(test.vi.mocked(captureContext).mock.calls[1]![0].additionalNoteIds)
      .toEqual([third]);
    second.unmount();
    mount(
      <Transformation
        id={id}
        notes={[
          { id, title: 'First' },
          { id: other, title: 'Second' }
        ]}
      />,
      first.client
    );
    test.expect(test.screen.getByLabelText('NoteOutputTitle')).toHaveValue('First group');
    test.fireEvent.click(await test.screen.findByRole('button', { name: 'Retry' }));
    await test.waitFor(() => test.expect(captureContext).toHaveBeenCalledTimes(3));
    test
      .expect(test.vi.mocked(captureContext).mock.calls[2]![0])
      .toEqual(test.vi.mocked(captureContext).mock.calls[0]![0]);
  }
);
test.mock('#client/lib/ai-readiness.ts', () => ({ useAiReadiness: test.vi.fn(() => 'ready') }));
