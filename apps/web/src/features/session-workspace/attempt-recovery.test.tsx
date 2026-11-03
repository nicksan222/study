import { StudyError } from '@study/contracts/errors';
import { sessionIdSchema } from '@study/contracts/ids';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Schema } from 'effect';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vite-plus/test';

import { Composer } from './composer';
import type { Draft } from './draft';
import type * as SessionQueries from './session-workspace.queries';
import {
  ask,
  captureContext,
  transformDocument,
  uploadSource,
  saveNote
} from './session-workspace.queries';
import { Transformation } from './transformation';
import { UnavailableAttempt } from './unavailable-attempt';

const reads = vi.hoisted(() => ({ selection: vi.fn(), thread: vi.fn(), runs: vi.fn() }));

vi.mock('../../lib/i18n', () => ({
  useI18n: () => ({ t: (key: string) => key, locale: 'english' })
}));
vi.mock('./history', () => ({ CapturedContext: () => null }));
vi.mock('./session-workspace.queries', async (load) => ({
  ...(await load<typeof SessionQueries>()),
  ask: vi.fn(),
  saveNote: vi.fn(),
  captureContext: vi.fn(),
  transformDocument: vi.fn(),
  uploadSource: vi.fn(),
  selectionOptions: () => ({ queryKey: ['recovery-selection'], queryFn: () => reads.selection() }),
  threadOptions: () => ({
    queryKey: ['recovery-thread'],
    initialPageParam: undefined,
    queryFn: () => reads.thread(),
    getNextPageParam: () => undefined
  }),
  sessionGenerationsOptions: () => ({
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

const id = Schema.decodeUnknownSync(sessionIdSchema)(501n);

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
  reads.selection.mockResolvedValue({ revision: 8n, targets: [] });
  reads.thread.mockResolvedValue({ items: [], next: null });
  reads.runs.mockResolvedValue({ items: [], next: null });
});
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
});

it.each(['selection', 'thread', 'runs'] as const)(
  'requires successful %s reconciliation and loses review authorization on remount',
  async (failedRead) => {
    const abandon = vi.fn();

    reads[failedRead].mockRejectedValueOnce(new StudyError('not_found', 'Unavailable'));
    const node = <UnavailableAttempt id={id} busy={false} onAbandon={abandon} />;
    const first = mount(node);

    fireEvent.click(screen.getByRole('button', { name: 'SessionReviewUnavailableAttempt' }));
    await screen.findByRole('alert');
    expect(screen.queryByRole('button', { name: 'SessionAbandonAttempt' })).toBeNull();
    expect(abandon).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'SessionReviewUnavailableAttempt' }));
    await screen.findByRole('button', { name: 'SessionAbandonAttempt' });
    expect(reads.selection).toHaveBeenCalledTimes(2);
    expect(reads.thread).toHaveBeenCalledTimes(2);
    expect(reads.runs).toHaveBeenCalledTimes(2);
    expect(abandon).not.toHaveBeenCalled();
    first.unmount();
    const reopened = mount(node, first.client);

    expect(screen.queryByRole('button', { name: 'SessionAbandonAttempt' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'SessionReviewUnavailableAttempt' }));
    await screen.findByRole('button', { name: 'SessionAbandonAttempt' });
    reopened.rerender(
      <QueryClientProvider client={first.client}>
        <UnavailableAttempt id={id} busy onAbandon={abandon} />
      </QueryClientProvider>
    );
    fireEvent.click(screen.getByRole('button', { name: 'SessionAbandonAttempt' }));
    expect(abandon).not.toHaveBeenCalled();
    reopened.rerender(<QueryClientProvider client={first.client}>{node}</QueryClientProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'SessionAbandonAttempt' }));
    expect(abandon).toHaveBeenCalledTimes(1);
    expect(ask).not.toHaveBeenCalled();
    expect(captureContext).not.toHaveBeenCalled();
  }
);

it('abandons a retained unavailable Ask after review and resumes plain capture with its attachments', async () => {
  vi.mocked(uploadSource).mockResolvedValue({ id: 44n } as Awaited<
    ReturnType<typeof uploadSource>
  >);
  vi.mocked(saveNote).mockResolvedValue({} as Awaited<ReturnType<typeof saveNote>>);
  const first = mount(<Composer id={id} />);

  fireEvent.change(screen.getByLabelText('SessionAttachFiles'), {
    target: { files: [new File(['notes'], 'retained.txt')] }
  });
  await screen.findByText('SessionFileAccepted');
  act(() =>
    first.client.setQueryData<Draft>(['session-drafts', String(id), 'note'], {
      text: 'Later draft',
      instruction: '',
      askUnavailable: true,
      askAttempt: {
        sessionId: id,
        intentKey: 'retired-ask',
        expectedSelectionRevision: 8n,
        text: 'Original question'
      }
    })
  );
  await screen.findByRole('button', { name: 'SessionReviewUnavailableAttempt' });
  first.unmount();
  mount(<Composer id={id} />, first.client);
  expect(screen.queryByRole('button', { name: 'SessionAsk' })).toBeNull();
  expect(screen.getByRole('button', { name: 'SessionSaveNote' })).toBeDisabled();
  expect(screen.queryByRole('button', { name: 'SessionRetryAsk' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'SessionReviewUnavailableAttempt' }));
  fireEvent.click(await screen.findByRole('button', { name: 'SessionAbandonAttempt' }));
  expect(screen.getByRole('textbox')).toHaveValue('Later draft');
  expect(screen.getByText('retained.txt')).toBeVisible();
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'SessionSaveNote' })).toBeEnabled()
  );
  fireEvent.click(screen.getByRole('button', { name: 'SessionSaveNote' }));
  await waitFor(() => expect(saveNote).toHaveBeenCalledExactlyOnceWith(id, 'Later draft', [44n]));
  expect(ask).not.toHaveBeenCalled();
  expect(uploadSource).toHaveBeenCalledTimes(1);
});

it('retains transform pending ownership and immutable retry inputs across remount and edited fields', async () => {
  const capture = deferred<Awaited<ReturnType<typeof captureContext>>>();

  vi.mocked(captureContext)
    .mockReturnValueOnce(capture.promise)
    .mockRejectedValueOnce(new StudyError('not_found', 'Retired capture'));
  vi.mocked(transformDocument).mockRejectedValueOnce(new StudyError('transient', 'Lost receipt'));
  const first = mount(<Transformation id={id} />);

  fireEvent.change(screen.getByLabelText('SessionOutputTitle'), {
    target: { value: 'Original title' }
  });
  fireEvent.change(screen.getByLabelText('SessionInstructions'), {
    target: { value: 'Original instruction' }
  });
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'SessionCreateDocument' })).toBeEnabled()
  );
  fireEvent.click(screen.getByRole('button', { name: 'SessionCreateDocument' }));
  await waitFor(() => expect(captureContext).toHaveBeenCalledTimes(1));
  const submitted = vi.mocked(captureContext).mock.calls[0]![0];

  first.unmount();
  const second = mount(<Transformation id={id} />, first.client);

  expect(screen.getByRole('button', { name: 'SessionCreateDocument' })).toBeDisabled();
  expect(captureContext).toHaveBeenCalledTimes(1);
  fireEvent.change(screen.getByLabelText('SessionOutputTitle'), {
    target: { value: 'Later title' }
  });
  fireEvent.change(screen.getByLabelText('SessionInstructions'), {
    target: { value: 'Later instruction' }
  });
  fireEvent.click(screen.getByRole('button', { name: 'SessionOpGrammar' }));
  await act(async () => {
    capture.resolve({ requestId: 'capture-1', selectionRevision: 8n } as Awaited<
      ReturnType<typeof captureContext>
    >);
    await capture.promise;
  });
  await screen.findByRole('button', { name: 'Retry' });
  expect(transformDocument).toHaveBeenCalledWith({
    contextRequestId: 'capture-1',
    title: 'Original title',
    operations: ['clarity']
  });
  second.unmount();
  const third = mount(<Transformation id={id} />, first.client);

  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  await screen.findByRole('button', { name: 'SessionReviewUnavailableAttempt' });
  expect(vi.mocked(captureContext).mock.calls[1]![0]).toEqual(submitted);
  expect(transformDocument).toHaveBeenCalledTimes(1);
  third.unmount();
  mount(<Transformation id={id} />, first.client);
  fireEvent.click(screen.getByRole('button', { name: 'SessionReviewUnavailableAttempt' }));
  fireEvent.click(await screen.findByRole('button', { name: 'SessionAbandonAttempt' }));
  expect(screen.getByLabelText('SessionOutputTitle')).toHaveValue('Later title');
  expect(screen.getByLabelText('SessionInstructions')).toHaveValue('Later instruction');
  expect(screen.getByRole('button', { name: 'SessionOpGrammar' })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  expect(captureContext).toHaveBeenCalledTimes(2);
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'SessionCreateDocument' })).toBeEnabled()
  );
  vi.mocked(captureContext).mockResolvedValueOnce({
    requestId: 'capture-2',
    selectionRevision: 8n
  } as Awaited<ReturnType<typeof captureContext>>);
  vi.mocked(transformDocument).mockRejectedValueOnce(
    new StudyError('transient', 'Unconfirmed new result')
  );
  fireEvent.click(screen.getByRole('button', { name: 'SessionCreateDocument' }));
  await waitFor(() => expect(transformDocument).toHaveBeenCalledTimes(2));
  expect(vi.mocked(captureContext).mock.calls[2]![0]).toMatchObject({
    instruction: 'Later instruction'
  });
  expect(vi.mocked(captureContext).mock.calls[2]![0].intentKey).not.toBe(submitted.intentKey);
  expect(vi.mocked(transformDocument).mock.calls[1]![0]).toEqual({
    contextRequestId: 'capture-2',
    title: 'Later title',
    operations: ['clarity', 'grammar']
  });
  await screen.findByRole('alert');
});

it('does not authorize abandonment until all reconciliation reads have completed', async () => {
  const runs = deferred<{ items: never[]; next: null }>();

  reads.runs.mockReturnValue(runs.promise);
  const abandon = vi.fn();

  mount(<UnavailableAttempt id={id} busy={false} onAbandon={abandon} />);
  fireEvent.click(screen.getByRole('button', { name: 'SessionReviewUnavailableAttempt' }));
  await waitFor(() => expect(reads.thread).toHaveBeenCalledTimes(1));
  expect(screen.getByRole('button', { name: 'SessionReviewUnavailableAttempt' })).toBeDisabled();
  expect(screen.queryByRole('button', { name: 'SessionAbandonAttempt' })).toBeNull();
  await act(async () => {
    runs.resolve({ items: [], next: null });
    await runs.promise;
  });
  await screen.findByRole('button', { name: 'SessionAbandonAttempt' });
  expect(abandon).not.toHaveBeenCalled();
});
