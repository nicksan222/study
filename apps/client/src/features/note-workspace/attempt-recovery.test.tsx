import { StudyError } from '@study/contracts/errors';
import { noteIdSchema } from '@study/contracts/ids';
import { testStable } from '@study/testing/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type * as Router from '@tanstack/react-router';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Schema } from 'effect';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, expect, vi } from 'vite-plus/test';

import { useAiReadiness } from '#client/lib/ai-readiness.ts';

import { Composer } from './composer';
import type { Draft } from './draft';
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

const reads = vi.hoisted(() => ({ selection: vi.fn(), thread: vi.fn(), runs: vi.fn() }));

vi.mock('@tanstack/react-router', async (load) => ({
  ...(await load<typeof Router>()),
  Link: ({ to, children }: { to: string; children?: ReactNode }) => <a href={to}>{children}</a>
}));

vi.mock('#client/lib/i18n.tsx', () => ({
  useI18n: () => ({ t: (key: string) => key, locale: 'english' })
}));
vi.mock('./history', () => ({ CapturedContext: () => null }));
vi.mock('./note-workspace.queries', async (load) => ({
  ...(await load<typeof NoteQueries>()),
  ask: vi.fn(),
  saveNote: vi.fn(),
  captureContext: vi.fn(),
  transformPage: vi.fn(),
  uploadSource: vi.fn(),
  selectionOptions: () => ({ queryKey: ['recovery-selection'], queryFn: () => reads.selection() }),
  threadOptions: () => ({
    queryKey: ['recovery-thread'],
    initialPageParam: undefined,
    queryFn: () => reads.thread(),
    getNextPageParam: () => undefined
  }),
  noteGenerationsOptions: () => ({
    queryKey: ['recovery-runs'],
    initialPageParam: undefined,
    queryFn: () => reads.runs(),
    getNextPageParam: () => undefined
  })
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });

  return { promise, resolve };
}

const id = Schema.decodeUnknownSync(noteIdSchema)(501n);

const clients: QueryClient[] = [];

function mount(
  node: ReactNode,
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
  })
) {
  if (!clients.includes(client)) clients.push(client);

  return { client, ...render(<QueryClientProvider client={client}>{node}</QueryClientProvider>) };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(useAiReadiness).mockReturnValue('ready');
  reads.selection.mockResolvedValue({ revision: 8n, targets: [] });
  reads.thread.mockResolvedValue({ items: [], next: null });
  reads.runs.mockResolvedValue({ items: [], next: null });
});
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
});

testStable.each(['selection', 'thread', 'runs'] as const)(
  'requires successful %s reconciliation and loses review authorization on remount',
  async (failedRead) => {
    const abandon = vi.fn();

    reads[failedRead].mockRejectedValueOnce(new StudyError('not_found', 'Unavailable'));
    const node = <UnavailableAttempt id={id} busy={false} onAbandon={abandon} />;
    const first = mount(node);

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
    const reopened = mount(node, first.client);

    expect(screen.queryByRole('button', { name: 'NoteAbandonAttempt' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'NoteReviewUnavailableAttempt' }));
    await screen.findByRole('button', { name: 'NoteAbandonAttempt' });
    reopened.rerender(
      <QueryClientProvider client={first.client}>
        <UnavailableAttempt id={id} busy onAbandon={abandon} />
      </QueryClientProvider>
    );
    fireEvent.click(screen.getByRole('button', { name: 'NoteAbandonAttempt' }));
    expect(abandon).not.toHaveBeenCalled();
    reopened.rerender(<QueryClientProvider client={first.client}>{node}</QueryClientProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'NoteAbandonAttempt' }));
    expect(abandon).toHaveBeenCalledTimes(1);
    expect(ask).not.toHaveBeenCalled();
    expect(captureContext).not.toHaveBeenCalled();
  }
);

testStable(
  'abandons a retained unavailable Ask after review and resumes plain capture with its attachments',
  async () => {
    vi.mocked(uploadSource).mockResolvedValue({ id: 44n } as Awaited<
      ReturnType<typeof uploadSource>
    >);
    vi.mocked(saveNote).mockResolvedValue({} as Awaited<ReturnType<typeof saveNote>>);
    const first = mount(<Composer id={id} />);

    fireEvent.change(screen.getByLabelText('NoteAttachFiles'), {
      target: { files: [new File(['notes'], 'retained.txt')] }
    });
    await screen.findByText('NoteFileAccepted');
    act(() =>
      first.client.setQueryData<Draft>(['note-drafts', String(id), 'note'], {
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
    mount(<Composer id={id} />, first.client);
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

testStable(
  'retains transform pending ownership and immutable retry inputs across remount and edited fields',
  async () => {
    const capture = deferred<Awaited<ReturnType<typeof captureContext>>>();
    const onStarted = vi.fn();

    vi.mocked(captureContext)
      .mockReturnValueOnce(capture.promise)
      .mockRejectedValueOnce(new StudyError('not_found', 'Retired capture'));
    vi.mocked(transformPage).mockRejectedValueOnce(new StudyError('transient', 'Lost receipt'));
    const first = mount(<Transformation id={id} onStarted={onStarted} />);

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
    const second = mount(<Transformation id={id} />, first.client);

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
    const unavailable = mount(<Transformation id={id} />, first.client);

    expect(screen.getByRole('button', { name: 'Retry' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(captureContext).toHaveBeenCalledTimes(1);
    unavailable.unmount();
    vi.mocked(useAiReadiness).mockReturnValue('ready');
    const third = mount(<Transformation id={id} />, first.client);

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await screen.findByRole('button', { name: 'NoteReviewUnavailableAttempt' });
    expect(vi.mocked(captureContext).mock.calls[1]![0]).toEqual(submitted);
    expect(transformPage).toHaveBeenCalledTimes(1);
    third.unmount();
    mount(<Transformation id={id} />, first.client);
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

testStable(
  'does not authorize abandonment until all reconciliation reads have completed',
  async () => {
    const runs = deferred<{ items: never[]; next: null }>();

    reads.runs.mockReturnValue(runs.promise);
    const abandon = vi.fn();

    mount(<UnavailableAttempt id={id} busy={false} onAbandon={abandon} />);
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

testStable(
  'combines externally selected notes into one immutable document attempt with optional instructions',
  async () => {
    vi.mocked(captureContext).mockRejectedValue(new StudyError('transient', 'Retry later'));
    const view = mount(
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
      <QueryClientProvider client={view.client}>
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
      </QueryClientProvider>
    );
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(captureContext).toHaveBeenCalledTimes(2));
    expect(vi.mocked(captureContext).mock.calls[1]![0]).toEqual(
      vi.mocked(captureContext).mock.calls[0]![0]
    );
  }
);

testStable(
  'keeps document recovery separate for different selected groups with the same first note',
  async () => {
    vi.mocked(captureContext).mockRejectedValue(new StudyError('transient', 'Retry later'));
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
vi.mock('#client/lib/ai-readiness.ts', () => ({ useAiReadiness: vi.fn(() => 'ready') }));
