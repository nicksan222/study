import { chatMessageSchema } from '@study/contracts/conversations/schemas';
import { StudyError } from '@study/contracts/errors';
import { sessionIdSchema } from '@study/contracts/ids';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Schema } from 'effect';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vite-plus/test';

import { attachmentKey } from './attachments';
import { Composer } from './composer';
import { MessageActions } from './message-actions';
import {
  activateVersion,
  ask,
  editNote,
  reanswerNote,
  rewriteNote,
  saveNote,
  uploadSource
} from './session-workspace.queries';
import { SessionRuns } from './transformation';

const rpc = vi.hoisted(() => ({ message: vi.fn(), pages: vi.fn() }));
vi.mock('../../lib/i18n', () => ({
  useI18n: () => ({ t: (key: string) => key, locale: 'english', date: String })
}));
vi.mock('../../lib/study-client/request', () => ({
  request: (fn: (client: { 'conversations.message': typeof rpc.message }) => unknown) =>
    fn({ 'conversations.message': rpc.message })
}));
vi.mock('../document-editing/proposal-review', () => ({
  ProposalReview: ({ requestId }: { requestId: string }) => (
    <div data-testid="proposal">{requestId}</div>
  )
}));
vi.mock('./session-workspace.queries', async (load) => {
  const actual = await load<typeof import('./session-workspace.queries')>();
  return {
    ...actual,
    uploadSource: vi.fn(),
    saveNote: vi.fn(),
    ask: vi.fn(),
    editNote: vi.fn(),
    rewriteNote: vi.fn(),
    reanswerNote: vi.fn(),
    activateVersion: vi.fn(),
    selectionOptions: () => ({
      queryKey: ['canvas-selection'],
      queryFn: async () => ({ revision: 8n, targets: [] })
    }),
    sessionGenerationsOptions: (id: unknown) => ({
      queryKey: ['canvas-generations', String(id)],
      initialPageParam: undefined,
      queryFn: ({ pageParam }: { pageParam: unknown }) => rpc.pages(pageParam),
      getNextPageParam: (page: { next: string | null }) => page.next ?? undefined
    }),
    generationOptions: (id: string) => ({
      queryKey: ['canvas-generation', id],
      queryFn: async () => ({
        title: 'Retained generation title',
        cancelled: true,
        resultVersionId: null,
        report: null
      })
    }),
    executionOptions: (id: string) => ({
      queryKey: ['canvas-execution', id],
      queryFn: async () => ({ items: [], next: null })
    })
  };
});
const id = Schema.decodeUnknownSync(sessionIdSchema)(501n);
const message = Schema.decodeUnknownSync(chatMessageSchema)({
  id: 71n,
  sessionId: id,
  role: 'user',
  threadRoot: null,
  replyTo: null,
  activeVersionId: 81n,
  recordingId: null,
  recordingMs: null,
  recordedIn: null,
  createdAt: 1n,
  versions: [
    {
      id: 80n,
      number: 1n,
      origin: 'typed',
      status: 'complete',
      text: 'Historical note',
      basedOn: null,
      instruction: null,
      createdAt: 1n
    },
    {
      id: 81n,
      number: 2n,
      origin: 'edited',
      status: 'complete',
      text: 'Current note',
      basedOn: 80n,
      instruction: null,
      createdAt: 2n
    }
  ],
  parts: [],
  citations: []
});
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
const actions = (versionId = message.activeVersionId!, value = message) => (
  <MessageActions message={value} versionId={versionId} onActive={() => {}} />
);
beforeEach(() => {
  vi.resetAllMocks();
  rpc.message.mockResolvedValue(message);
  rpc.pages.mockResolvedValue({ items: [], next: null });
});
afterEach(() => {
  cleanup();
  for (const client of clients.splice(0)) client.clear();
});

it('keeps an uncertain upload across remount and never automatically creates it twice', async () => {
  vi.mocked(uploadSource).mockRejectedValue(new StudyError('transient', 'Unconfirmed'));
  const first = mount(<Composer id={id} />);
  fireEvent.change(screen.getByLabelText('SessionAttachFiles'), {
    target: { files: [new File(['notes'], 'notes.txt')] }
  });
  await screen.findByText('SessionUploadUncertain');
  expect(uploadSource).toHaveBeenCalledTimes(1);
  first.unmount();
  mount(<Composer id={id} />, first.client);
  expect(screen.getByText('notes.txt')).toBeVisible();
  expect(screen.getByRole('button', { name: 'SessionSaveNote' })).toBeDisabled();
  expect(uploadSource).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
});
it('sends attachment-only notes with accepted source IDs and does not upload again on send', async () => {
  vi.mocked(uploadSource).mockResolvedValue({ id: 44n } as Awaited<
    ReturnType<typeof uploadSource>
  >);
  vi.mocked(saveNote).mockResolvedValue(message);
  mount(<Composer id={id} />);
  fireEvent.drop(screen.getByRole('region', { name: 'SessionCompose' }), {
    dataTransfer: { files: [new File(['notes'], 'notes.txt')] }
  });
  await screen.findByText('SessionFileAccepted');
  fireEvent.click(screen.getByRole('button', { name: 'SessionSaveNote' }));
  await waitFor(() => expect(saveNote).toHaveBeenCalledWith(id, '', [44n]));
  await waitFor(() => expect(screen.queryByText('notes.txt')).not.toBeInTheDocument());
  expect(uploadSource).toHaveBeenCalledTimes(1);
  expect(ask).not.toHaveBeenCalled();
});
it('keeps upload ownership while a receipt arrives after unmount', async () => {
  let accept!: (value: Awaited<ReturnType<typeof uploadSource>>) => void;
  vi.mocked(uploadSource).mockImplementation(
    () =>
      new Promise((resolve) => {
        accept = resolve;
      })
  );
  const first = mount(<Composer id={id} />);
  fireEvent.change(screen.getByLabelText('SessionAttachFiles'), {
    target: { files: [new File(['n'], 'n.txt')] }
  });
  first.unmount();
  mount(<Composer id={id} />, first.client);
  expect(screen.getByText('SessionUploading')).toBeVisible();
  await act(async () => accept({ id: 45n } as Awaited<ReturnType<typeof uploadSource>>));
  await screen.findByText('SessionFileAccepted');
  expect(first.client.getQueryData(attachmentKey(id))).toEqual([
    expect.objectContaining({ sourceId: 45n, state: 'ready' })
  ]);
  expect(uploadSource).toHaveBeenCalledTimes(1);
});
it('retains a definite rejection and only retries after a deliberate click', async () => {
  vi.mocked(uploadSource)
    .mockRejectedValueOnce(new StudyError('invalid_input', 'Unsupported'))
    .mockResolvedValueOnce({ id: 46n } as Awaited<ReturnType<typeof uploadSource>>);
  mount(<Composer id={id} />);
  fireEvent.change(screen.getByLabelText('SessionAttachFiles'), {
    target: { files: [new File(['n'], 'n.txt')] }
  });
  await screen.findByText('SessionFileRejected');
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  await screen.findByText('SessionFileAccepted');
  expect(uploadSource).toHaveBeenCalledTimes(2);
});
it.each([
  ['SessionImprove', 'improve'],
  ['SessionSummarize', 'summarize']
] as const)(
  'targets the exact message for %s and retains its request receipt',
  async (label, origin) => {
    vi.mocked(rewriteNote).mockResolvedValue({
      requestId: 'rewrite-exact',
      sessionId: id,
      messageId: message.id,
      versionId: message.activeVersionId!
    });
    mount(actions());
    fireEvent.click(screen.getByRole('button', { name: label }));
    expect(screen.getByText(/^SessionItemTransformScope/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'SessionApplyAction' }));
    await waitFor(() =>
      expect(rewriteNote).toHaveBeenCalledWith({
        messageId: message.id,
        origin,
        instruction: undefined
      })
    );
  }
);
it('keeps the edit payload and write fence across remounts until the original receipt', async () => {
  let accept!: (value: typeof message) => void;
  vi.mocked(editNote).mockImplementation(
    () =>
      new Promise((resolve) => {
        accept = resolve;
      })
  );
  const first = mount(actions());
  fireEvent.click(screen.getByRole('button', { name: 'SessionEditNote' }));
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Edited note' } });
  fireEvent.click(screen.getByRole('button', { name: 'SessionSaveNote' }));
  await waitFor(() =>
    expect(editNote).toHaveBeenCalledWith({ messageId: message.id, text: 'Edited note' })
  );
  first.unmount();
  mount(actions(), first.client);
  expect(screen.getByRole('button', { name: 'SessionSaveNote' })).toBeDisabled();
  await act(async () => accept(message));
  await waitFor(() => expect(screen.queryByRole('textbox')).not.toBeInTheDocument());
  expect(editNote).toHaveBeenCalledTimes(1);
});
it('does not rewrite a changed active version or silently use a historical version', async () => {
  rpc.message.mockResolvedValue({ ...message, activeVersionId: message.versions[0]!.id });
  mount(actions());
  fireEvent.click(screen.getByRole('button', { name: 'SessionImprove' }));
  fireEvent.click(screen.getByRole('button', { name: 'SessionApplyAction' }));
  await screen.findByRole('alert');
  expect(rewriteNote).not.toHaveBeenCalled();
});
it('offers explicit historical activation and sends setActiveVersion with its exact identity', async () => {
  vi.mocked(activateVersion).mockResolvedValue(message);
  mount(actions(message.versions[0]!.id));
  expect(screen.queryByRole('button', { name: 'SessionImprove' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'SessionUseVersion' }));
  fireEvent.click(screen.getByRole('button', { name: 'SessionApplyAction' }));
  await waitFor(() =>
    expect(activateVersion).toHaveBeenCalledWith({
      messageId: message.id,
      versionId: message.versions[0]!.id
    })
  );
});
it('never replays a rewrite after uncertain acceptance and remount', async () => {
  vi.mocked(rewriteNote).mockRejectedValue(new StudyError('transient', 'Unconfirmed'));
  const first = mount(actions());
  fireEvent.click(screen.getByRole('button', { name: 'SessionImprove' }));
  fireEvent.click(screen.getByRole('button', { name: 'SessionApplyAction' }));
  await screen.findByText('SessionItemActionUncertain');
  first.unmount();
  mount(actions(), first.client);
  expect(screen.getByRole('button', { name: 'SessionImprove' })).toBeDisabled();
  expect(rewriteNote).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
});
it('sends custom instructions only to the chosen message', async () => {
  vi.mocked(rewriteNote).mockResolvedValue({
    requestId: 'custom',
    sessionId: id,
    messageId: message.id,
    versionId: message.activeVersionId!
  });
  mount(actions());
  fireEvent.click(screen.getByRole('button', { name: 'SessionCustomTransform' }));
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Use shorter sentences' } });
  fireEvent.click(screen.getByRole('button', { name: 'SessionApplyAction' }));
  await waitFor(() =>
    expect(rewriteNote).toHaveBeenCalledWith({
      messageId: message.id,
      origin: 'instruction',
      instruction: 'Use shorter sentences'
    })
  );
});
it('reanswers only an assistant reply with a retained replyTo target', async () => {
  const assistant = { ...message, role: 'assistant' as const, replyTo: message.id };
  vi.mocked(reanswerNote).mockResolvedValue({
    requestId: 'reanswer',
    sessionId: id,
    messageId: message.id,
    versionId: message.activeVersionId!
  });
  rpc.message.mockResolvedValue(assistant);
  mount(actions(message.activeVersionId!, assistant));
  fireEvent.click(screen.getByRole('button', { name: 'SessionReanswer' }));
  fireEvent.click(screen.getByRole('button', { name: 'SessionApplyAction' }));
  await waitFor(() => expect(reanswerNote).toHaveBeenCalledWith(message.id));
  expect(rewriteNote).not.toHaveBeenCalled();
});
it('uses atomic Ask with an explicit quoted target and retries its original identity', async () => {
  vi.mocked(ask)
    .mockRejectedValueOnce(new StudyError('transient', 'Unconfirmed'))
    .mockResolvedValueOnce({ requestId: 'ask-exact' } as Awaited<ReturnType<typeof ask>>);
  const first = mount(actions());
  fireEvent.click(screen.getByRole('button', { name: 'SessionAsk' }));
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Why is this true?' } });
  const editor = screen.getByRole('region', { name: 'SessionItemActions' });
  await waitFor(() =>
    expect(within(editor).getByRole('button', { name: 'SessionAsk' })).toBeEnabled()
  );
  fireEvent.click(within(editor).getByRole('button', { name: 'SessionAsk' }));
  await screen.findByRole('alert');
  const input = vi.mocked(ask).mock.calls[0]![0];
  expect(input).toMatchObject({
    sessionId: id,
    expectedSelectionRevision: 8n,
    text: 'Why is this true?'
  });
  expect(JSON.parse(input.instruction!)).toMatchObject({
    targetMessageId: '71',
    targetVersionId: '81',
    targetText: 'Current note'
  });
  first.unmount();
  mount(actions(), first.client);
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  await waitFor(() => expect(ask).toHaveBeenCalledTimes(2));
  expect(vi.mocked(ask).mock.calls[1]![0]).toEqual(input);
  expect(saveNote).not.toHaveBeenCalled();
});
it('discovers canonical runs on a cold mount, paginates exact cursors, and mounts only retained proposals', async () => {
  const run = {
    requestId: 'request-z',
    contextRequestId: null,
    state: 'available',
    cancelled: false,
    resultVersionId: null,
    proposedVersionId: 90n,
    baseVersionId: 89n
  };
  rpc.pages.mockImplementation((before) =>
    Promise.resolve(
      before
        ? {
            items: [
              {
                ...run,
                requestId: 'retired-a',
                state: 'retired',
                proposedVersionId: null,
                baseVersionId: null
              }
            ],
            next: null
          }
        : {
            items: [
              run,
              { ...run, requestId: 'unavailable-b', state: 'unavailable', proposedVersionId: null }
            ],
            next: 'request-z'
          }
    )
  );
  mount(<SessionRuns id={id} />);
  expect(await screen.findByTestId('proposal')).toHaveTextContent('request-z');
  expect(screen.getAllByText('SessionContextUnavailable')[0]).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'LibraryMore' }));
  await screen.findAllByText('SessionRunRetired');
  expect(rpc.pages).toHaveBeenCalledWith('request-z');
  expect(screen.getAllByTestId('proposal')).toHaveLength(1);
});

it('includes accepted files in one atomic Ask and never posts a separate note', async () => {
  vi.mocked(uploadSource).mockResolvedValue({ id: 47n } as Awaited<
    ReturnType<typeof uploadSource>
  >);
  vi.mocked(ask).mockResolvedValue({ requestId: 'attachment-ask' } as Awaited<
    ReturnType<typeof ask>
  >);
  mount(<Composer id={id} />);
  fireEvent.change(screen.getByLabelText('SessionAttachFiles'), {
    target: { files: [new File(['n'], 'n.txt')] }
  });
  await screen.findByText('SessionFileAccepted');
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Explain this attachment' } });
  fireEvent.click(screen.getByRole('button', { name: 'SessionAsk' }));
  await waitFor(() =>
    expect(ask).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: id,
        sourceIds: [47n],
        text: 'Explain this attachment',
        expectedSelectionRevision: 8n
      })
    )
  );
  expect(saveNote).not.toHaveBeenCalled();
  expect(uploadSource).toHaveBeenCalledTimes(1);
});
it('keeps the original note and source payload after an uncertain post without replay', async () => {
  vi.mocked(uploadSource).mockResolvedValue({ id: 48n } as Awaited<
    ReturnType<typeof uploadSource>
  >);
  vi.mocked(saveNote).mockRejectedValue(new StudyError('transient', 'Unconfirmed'));
  const first = mount(<Composer id={id} />);
  fireEvent.change(screen.getByLabelText('SessionAttachFiles'), {
    target: { files: [new File(['n'], 'n.txt')] }
  });
  await screen.findByText('SessionFileAccepted');
  fireEvent.click(screen.getByRole('button', { name: 'SessionSaveNote' }));
  await screen.findByText('SessionNoteUncertain');
  first.unmount();
  mount(<Composer id={id} />, first.client);
  expect(first.client.getQueryData(['session-drafts', String(id), 'note'])).toMatchObject({
    noteAttempt: '',
    noteSourceIds: [48n]
  });
  expect(screen.getByRole('button', { name: 'SessionSaveNote' })).toBeDisabled();
  expect(saveNote).toHaveBeenCalledTimes(1);
  expect(uploadSource).toHaveBeenCalledTimes(1);
});

it('hands focus to the item editor and restores the invoking action on cancel', async () => {
  mount(actions());
  const trigger = screen.getByRole('button', { name: 'SessionEditNote' });
  trigger.focus();
  fireEvent.click(trigger);
  expect(await screen.findByRole('textbox', { name: 'SessionEditNote' })).toHaveFocus();
  fireEvent.click(screen.getByRole('button', { name: 'SessionCancel' }));
  expect(trigger).toHaveFocus();
  expect(screen.queryByRole('button', { name: 'SessionVersions' })).toBeNull();
});
it('does not expose editing actions on an historical version', () => {
  mount(actions(message.versions[0]!.id));
  expect(screen.queryByRole('button', { name: 'SessionEditNote' })).toBeNull();
  expect(screen.getByRole('button', { name: 'SessionUseVersion' })).toBeEnabled();
});

it('puts the saved task title above technical run details without inventing a date', async () => {
  rpc.pages.mockResolvedValue({
    items: [
      {
        requestId: 'technical-request-identity',
        contextRequestId: null,
        state: 'available',
        cancelled: true,
        resultVersionId: null,
        proposedVersionId: null,
        baseVersionId: null
      }
    ],
    next: null
  });
  mount(<SessionRuns id={id} />);
  expect(await screen.findByText('Retained generation title')).toBeVisible();
  const identity = screen.getByText('technical-request-identity');
  expect(identity.closest('details')).not.toHaveAttribute('open');
  expect(identity.closest('section')?.querySelector('time')).toBeNull();
});
