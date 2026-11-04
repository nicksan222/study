import { chatMessageSchema } from '@study/contracts/conversations/schemas';
import { StudyError } from '@study/contracts/errors';
import { sessionIdSchema } from '@study/contracts/ids';
import { testStable } from '@study/testing/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Schema } from 'effect';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, expect, vi } from 'vite-plus/test';

import { attachmentKey } from './attachments';
import { Composer } from './composer';
import { MessageActions } from './message-actions';
import type * as SessionQueries from './session-workspace.queries';
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

const rpc = vi.hoisted(() => ({ message: vi.fn(), pages: vi.fn(), archive: vi.fn() }));

vi.mock('#web/lib/i18n.tsx', () => ({
  useI18n: () => ({ t: (key: string) => key, locale: 'english', date: String })
}));
vi.mock('#web/lib/study-client/request.ts', () => ({
  request: (
    fn: (client: {
      'conversations.message': typeof rpc.message;
      'conversations.setItemArchived': typeof rpc.archive;
    }) => unknown
  ) => fn({ 'conversations.message': rpc.message, 'conversations.setItemArchived': rpc.archive })
}));
vi.mock('../document-editing/proposal-review', () => ({
  ProposalReview: ({ requestId }: { requestId: string }) => (
    <div data-testid="proposal">{requestId}</div>
  )
}));
vi.mock('./session-workspace.queries', async (load) => {
  const actual = await load<typeof SessionQueries>();

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

testStable(
  'keeps an uncertain upload across remount and never automatically creates it twice',
  async () => {
    vi.mocked(uploadSource).mockRejectedValue(new StudyError('transient', 'Unconfirmed'));
    const first = mount(<Composer id={id} />);

    await act(async () => {
      fireEvent.change(screen.getByLabelText('SessionAttachFiles'), {
        target: { files: [new File(['notes'], 'notes.txt')] }
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await screen.findByText('SessionUploadUncertain');
    expect(uploadSource).toHaveBeenCalledTimes(1);
    first.unmount();
    mount(<Composer id={id} />, first.client);
    expect(screen.getByText('notes.txt')).toBeVisible();
    expect(screen.getByRole('button', { name: 'SessionSaveNote' })).toBeDisabled();
    expect(uploadSource).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  }
);

testStable(
  'sends attachment-only notes with accepted source IDs and does not upload again on send',
  async () => {
    vi.mocked(uploadSource).mockResolvedValue({ id: 44n } as Awaited<
      ReturnType<typeof uploadSource>
    >);
    vi.mocked(saveNote).mockResolvedValue(message);
    mount(<Composer id={id} />);
    await act(async () => {
      fireEvent.drop(screen.getByRole('region', { name: 'SessionCompose' }), {
        dataTransfer: { files: [new File(['notes'], 'notes.txt')] }
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await screen.findByText('SessionFileAccepted');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'SessionSaveNote' }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await waitFor(() => expect(saveNote).toHaveBeenCalledWith(id, '', [44n]));
    await waitFor(() => expect(screen.queryByText('notes.txt')).not.toBeInTheDocument());
    expect(uploadSource).toHaveBeenCalledTimes(1);
    expect(ask).not.toHaveBeenCalled();
  }
);

testStable('keeps upload ownership while a receipt arrives after unmount', async () => {
  let accept!: (value: Awaited<ReturnType<typeof uploadSource>>) => void;

  vi.mocked(uploadSource).mockImplementation(
    () =>
      new Promise((resolve) => {
        accept = resolve;
      })
  );
  const first = mount(<Composer id={id} />);

  await act(async () => {
    fireEvent.change(screen.getByLabelText('SessionAttachFiles'), {
      target: { files: [new File(['n'], 'n.txt')] }
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
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

testStable('retains a definite rejection and only retries after a deliberate click', async () => {
  vi.mocked(uploadSource)
    .mockRejectedValueOnce(new StudyError('invalid_input', 'Unsupported'))
    .mockResolvedValueOnce({ id: 46n } as Awaited<ReturnType<typeof uploadSource>>);
  mount(<Composer id={id} />);
  await act(async () => {
    fireEvent.change(screen.getByLabelText('SessionAttachFiles'), {
      target: { files: [new File(['n'], 'n.txt')] }
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  await screen.findByText('SessionFileRejected');
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  await screen.findByText('SessionFileAccepted');
  expect(uploadSource).toHaveBeenCalledTimes(2);
});

testStable.each([
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
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: label }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(screen.getByText(/^SessionItemTransformScope/)).toBeVisible();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'SessionApplyAction' }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await waitFor(() =>
      expect(rewriteNote).toHaveBeenCalledWith({
        messageId: message.id,
        origin,
        instruction: undefined
      })
    );
  }
);

testStable(
  'keeps the edit payload and write fence across remounts until the original receipt',
  async () => {
    let accept!: (value: typeof message) => void;

    vi.mocked(editNote).mockImplementation(
      () =>
        new Promise((resolve) => {
          accept = resolve;
        })
    );
    const first = mount(actions());

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'SessionEditNote' }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await act(async () => {
      const input = screen.getByRole('textbox');

      await userEvent.clear(input);
      await userEvent.type(input, 'Edited note', { skipClick: true });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'SessionSaveNote' }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await waitFor(() =>
      expect(editNote).toHaveBeenCalledWith({ messageId: message.id, text: 'Edited note' })
    );
    first.unmount();
    mount(actions(), first.client);
    expect(screen.getByRole('button', { name: 'SessionSaveNote' })).toBeDisabled();
    await act(async () => accept(message));
    await waitFor(() => expect(screen.queryByRole('textbox')).not.toBeInTheDocument());
    expect(editNote).toHaveBeenCalledTimes(1);
  }
);

testStable(
  'does not rewrite a changed active version or silently use a historical version',
  async () => {
    rpc.message.mockResolvedValue({ ...message, activeVersionId: message.versions[0]!.id });
    mount(actions());
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'SessionImprove', hidden: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'SessionApplyAction' }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await screen.findByRole('alert');
    expect(rewriteNote).not.toHaveBeenCalled();
  }
);

testStable(
  'offers explicit historical activation and sends setActiveVersion with its exact identity',
  async () => {
    vi.mocked(activateVersion).mockResolvedValue(message);
    mount(actions(message.versions[0]!.id));
    expect(screen.getByRole('button', { name: 'SessionImprove', hidden: true })).toBeDisabled();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'SessionUseVersion' }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'SessionApplyAction' }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await waitFor(() =>
      expect(activateVersion).toHaveBeenCalledWith({
        messageId: message.id,
        versionId: message.versions[0]!.id
      })
    );
  }
);

testStable('never replays a rewrite after uncertain acceptance and remount', async () => {
  vi.mocked(rewriteNote).mockRejectedValue(new StudyError('transient', 'Unconfirmed'));
  const first = mount(actions());

  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'SessionImprove', hidden: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'SessionApplyAction' }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  await screen.findByText('SessionItemActionUncertain');
  first.unmount();
  mount(actions(), first.client);
  expect(screen.getByRole('button', { name: 'SessionImprove', hidden: true })).toBeDisabled();
  expect(rewriteNote).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
});

testStable('sends custom instructions only to the chosen message', async () => {
  vi.mocked(rewriteNote).mockResolvedValue({
    requestId: 'custom',
    sessionId: id,
    messageId: message.id,
    versionId: message.activeVersionId!
  });
  mount(actions());
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'SessionCustomTransform', hidden: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  await act(async () => {
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Use shorter sentences' } });
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'SessionApplyAction' }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  await waitFor(() =>
    expect(rewriteNote).toHaveBeenCalledWith({
      messageId: message.id,
      origin: 'instruction',
      instruction: 'Use shorter sentences'
    })
  );
});

testStable('offers editing actions without Ask or Reanswer for existing entries', () => {
  const assistant = { ...message, role: 'assistant' as const, replyTo: message.id };

  mount(actions(message.activeVersionId!, assistant));
  expect(screen.queryByRole('button', { name: 'SessionAsk' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'SessionReanswer' })).toBeNull();
  expect(screen.getByRole('button', { name: 'SessionImprove', hidden: true })).toBeVisible();
  expect(reanswerNote).not.toHaveBeenCalled();
  expect(ask).not.toHaveBeenCalled();
});

testStable(
  'retains exact retry identity for an Ask operation already stored before the capture-only UI',
  async () => {
    vi.mocked(ask).mockResolvedValue({ requestId: 'ask-exact' } as Awaited<ReturnType<typeof ask>>);
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
    });
    const input = {
      sessionId: id,
      expectedSelectionRevision: 8n,
      intentKey: 'retained-quoted-ask',
      text: 'Why is this true?',
      instruction: JSON.stringify({
        targetMessageId: '71',
        targetVersionId: '81',
        targetText: 'Current note'
      })
    };

    client.setQueryData(['session-drafts', String(id), 'message-action', String(message.id)], {
      text: '',
      instruction: '',
      error: new StudyError('transient', 'Unconfirmed'),
      attempt: {
        action: 'ask',
        versionId: message.activeVersionId,
        text: '',
        instruction: '',
        askInput: input
      }
    });
    const first = mount(actions(), client);

    expect(screen.queryByRole('button', { name: 'SessionAsk' })).toBeNull();
    first.unmount();
    mount(actions(), client);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(ask).toHaveBeenCalledExactlyOnceWith(input));
    expect(saveNote).not.toHaveBeenCalled();
  }
);

testStable(
  'discovers canonical runs on a cold mount, paginates exact cursors, and mounts only retained proposals',
  async () => {
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
                {
                  ...run,
                  requestId: 'unavailable-b',
                  state: 'unavailable',
                  proposedVersionId: null
                }
              ],
              next: 'request-z'
            }
      )
    );
    mount(<SessionRuns id={id} />);
    expect(await screen.findByTestId('proposal')).toHaveTextContent('request-z');
    expect(screen.getAllByText('SessionContextUnavailable')[0]).toBeVisible();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'LibraryMore' }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await screen.findAllByText('SessionRunRetired');
    expect(rpc.pages).toHaveBeenCalledWith('request-z');
    expect(screen.getAllByTestId('proposal')).toHaveLength(1);
  }
);

testStable(
  'captures accepted files and plain text together without requesting a reply',
  async () => {
    vi.mocked(uploadSource).mockResolvedValue({ id: 47n } as Awaited<
      ReturnType<typeof uploadSource>
    >);
    vi.mocked(saveNote).mockResolvedValue(message);
    mount(<Composer id={id} />);
    fireEvent.change(screen.getByLabelText('SessionAttachFiles'), {
      target: { files: [new File(['n'], 'n.txt')] }
    });
    await screen.findByText('SessionFileAccepted');
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'Keep this with the lecture' }
    });
    expect(screen.queryByRole('button', { name: 'SessionAsk' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'SessionSaveNote' }));
    await waitFor(() =>
      expect(saveNote).toHaveBeenCalledExactlyOnceWith(id, 'Keep this with the lecture', [47n])
    );
    expect(ask).not.toHaveBeenCalled();
    expect(uploadSource).toHaveBeenCalledTimes(1);
  }
);

testStable(
  'keeps the original note and source payload after an uncertain post without replay',
  async () => {
    vi.mocked(uploadSource).mockResolvedValue({ id: 48n } as Awaited<
      ReturnType<typeof uploadSource>
    >);
    vi.mocked(saveNote).mockRejectedValue(new StudyError('transient', 'Unconfirmed'));
    const first = mount(<Composer id={id} />);

    await act(async () => {
      fireEvent.change(screen.getByLabelText('SessionAttachFiles'), {
        target: { files: [new File(['n'], 'n.txt')] }
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await screen.findByText('SessionFileAccepted');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'SessionSaveNote' }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
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
  }
);

testStable(
  'hands focus to the item editor and restores the invoking action on cancel',
  async () => {
    mount(actions());
    const trigger = screen.getByRole('button', { name: 'SessionEditNote' });

    trigger.focus();
    await act(async () => {
      fireEvent.click(trigger);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'SessionEditNote' })).toHaveFocus()
    );
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'SessionCancel' }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(trigger).toHaveFocus();
    expect(screen.queryByRole('button', { name: 'SessionVersions' })).toBeNull();
  }
);

testStable('keeps editing actions disabled on a historical version', () => {
  mount(actions(message.versions[0]!.id));
  expect(screen.getByRole('button', { name: 'SessionEditNote' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'SessionImprove', hidden: true })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'SessionUseVersion' })).toBeEnabled();
});

testStable(
  'puts the saved task title above technical run details without inventing a date',
  async () => {
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
  }
);

function VersionedNote({ value = message }: { value?: typeof message }) {
  const [versionId, setVersionId] = useState(value.activeVersionId!);

  return (
    <MessageActions
      message={value}
      versionId={versionId}
      onActive={() => setVersionId(value.activeVersionId!)}
      onVersionChange={setVersionId}
    >
      <p>{value.versions.find((version) => version.id === versionId)?.text}</p>
    </MessageActions>
  );
}

testStable(
  'browses exact saved versions with inline boundaries and a Latest badge without activating them',
  async () => {
    mount(<VersionedNote />);
    expect(screen.getByRole('button', { name: 'SessionNextVersion' })).toBeDisabled();
    expect(screen.getByText('SessionVersionLatest')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'SessionPreviousVersion' }));
    expect(screen.getByText('Historical note')).toBeVisible();
    expect(screen.getByText('1', { selector: '[role="status"]' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'SessionPreviousVersion' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'SessionUseVersion' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'SessionNextVersion' }));
    expect(screen.getByText('Current note')).toBeVisible();
    expect(screen.getByText('SessionVersionLatest')).toBeVisible();
    expect(activateVersion).not.toHaveBeenCalled();
  }
);

testStable(
  'keeps version browsing disabled while an edit or uncertain write owns the note and restores it after review',
  async () => {
    vi.mocked(editNote).mockRejectedValue(new StudyError('transient', 'Uncertain edit'));
    mount(<VersionedNote />);
    fireEvent.click(screen.getByRole('button', { name: 'SessionEditNote' }));
    await waitFor(() => expect(screen.getByLabelText('SessionPreviousVersion')).toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: 'SessionCancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(screen.getByLabelText('SessionPreviousVersion')).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'SessionEditNote' }));
    fireEvent.click(await screen.findByRole('button', { name: 'SessionSaveNote' }));
    await screen.findByRole('alert');
    await waitFor(() => expect(screen.getByLabelText('SessionPreviousVersion')).toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: 'LibraryRefresh' }));
    fireEvent.click(await screen.findByRole('button', { name: 'SessionReviewedHistory' }));
    await waitFor(() => expect(screen.getByLabelText('SessionPreviousVersion')).toBeEnabled());
  }
);

testStable('labels the newest saved version Latest even when another version is active', () => {
  mount(
    <VersionedNote
      value={{
        ...message,
        activeVersionId: message.versions[0]!.id,
        versions: [...message.versions].reverse()
      }}
    />
  );
  expect(screen.getByText('1', { selector: '[role="status"]' })).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'SessionNextVersion' }));
  expect(screen.getByText('SessionVersionLatest')).toBeVisible();
  expect(screen.getByRole('button', { name: 'SessionUseVersion' })).toBeEnabled();
  expect(activateVersion).not.toHaveBeenCalled();
});

testStable('retains the same action controls while browsing saved versions', () => {
  mount(<VersionedNote />);
  const edit = screen.getByRole('button', { name: 'SessionEditNote' });
  const improve = screen.getByRole('button', { name: 'SessionImprove', hidden: true });
  const activate = screen.getByRole('button', { name: 'SessionUseVersion' });

  expect(activate).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'SessionPreviousVersion' }));
  expect(screen.getByRole('button', { name: 'SessionEditNote' })).toBe(edit);
  expect(screen.getByRole('button', { name: 'SessionImprove', hidden: true })).toBe(improve);
  expect(screen.getByRole('button', { name: 'SessionUseVersion' })).toBe(activate);
  expect(edit).toBeDisabled();
  expect(improve).toBeDisabled();
  expect(activate).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: 'SessionNextVersion' }));
  expect(edit).toBeEnabled();
  expect(improve).toBeEnabled();
  expect(activate).toBeDisabled();
});

testStable('protects an open edit from other toolbar actions', async () => {
  mount(<VersionedNote />);
  fireEvent.click(screen.getByRole('button', { name: 'SessionEditNote' }));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'SessionImprove', hidden: true })).toBeDisabled()
  );
  expect(
    screen.getByRole('button', { name: 'SessionCustomTransform', hidden: true })
  ).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'SessionCancel' }));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'SessionImprove', hidden: true })).toBeEnabled()
  );
});

testStable(
  'opens deliberate editing in a dialog while keeping the saved note in the notebook',
  async () => {
    mount(<VersionedNote />);
    fireEvent.click(screen.getByRole('button', { name: 'SessionEditNote' }));
    expect(await screen.findByRole('dialog', { name: 'SessionEditNote' })).toBeVisible();
    expect(screen.getByText('Current note', { selector: 'p' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'SessionCancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(editNote).not.toHaveBeenCalled();
  }
);

testStable('opens note actions on right click and edits the exact selected note', async () => {
  mount(<VersionedNote />);
  fireEvent.contextMenu(screen.getByText('Current note'), { button: 2, clientX: 80, clientY: 80 });
  await userEvent.setup().click(await screen.findByRole('menuitem', { name: 'SessionEditNote' }));
  expect(await screen.findByRole('dialog')).toBeVisible();
  expect(screen.getByRole('textbox', { name: 'SessionEditNote' })).toHaveValue('Current note');
  expect(editNote).not.toHaveBeenCalled();
});

testStable(
  'restricts historical note context actions to activating the selected version',
  async () => {
    mount(<VersionedNote />);
    fireEvent.click(screen.getByRole('button', { name: 'SessionPreviousVersion' }));
    fireEvent.contextMenu(screen.getByText('Historical note'), {
      button: 2,
      clientX: 80,
      clientY: 80
    });
    expect(await screen.findByRole('menuitem', { name: 'SessionImprove' })).toHaveAttribute(
      'aria-disabled',
      'true'
    );
    expect(screen.getByRole('menuitem', { name: 'SessionEditNote' })).toHaveAttribute(
      'aria-disabled',
      'true'
    );
    await userEvent.setup().click(screen.getByRole('menuitem', { name: 'SessionUseVersion' }));
    expect(await screen.findByRole('dialog')).toBeVisible();
    expect(screen.getByRole('dialog')).toHaveTextContent('Historical note');
    expect(activateVersion).not.toHaveBeenCalled();
  }
);

testStable(
  'keeps pending assistant message context actions disabled and hides note editing',
  async () => {
    const pending = {
      ...message,
      role: 'assistant' as const,
      versions: message.versions.map((version) => ({ ...version, status: 'pending' as const }))
    };

    mount(<VersionedNote value={pending} />);
    fireEvent.contextMenu(screen.getByText('Current note'), {
      button: 2,
      clientX: 80,
      clientY: 80
    });
    expect(await screen.findByRole('menuitem', { name: 'SessionImprove' })).toHaveAttribute(
      'aria-disabled',
      'true'
    );
    expect(screen.queryByRole('menuitem', { name: 'SessionEditNote' })).toBeNull();
  }
);

testStable('keeps raw note deletion in both the toolbar and right-click menu', async () => {
  mount(<VersionedNote />);
  expect(screen.getByRole('button', { name: 'SessionDeleteItem' })).toBeVisible();
  expect(screen.getByRole('button', { name: 'SessionDeleteVersion' })).toBeVisible();
  fireEvent.contextMenu(screen.getByText('Current note'), { button: 2, clientX: 80, clientY: 80 });
  expect(await screen.findByRole('menuitem', { name: 'SessionDeleteItem' })).toBeVisible();
  await userEvent.setup().click(screen.getByRole('menuitem', { name: 'SessionDeleteVersion' }));
  const dialog = await screen.findByRole('alertdialog');

  expect(within(dialog).getByText('SessionDeleteVersionHelp')).toBeVisible();
  await userEvent.setup().click(within(dialog).getByRole('button', { name: 'Cancel' }));
  await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
  expect(screen.getByRole('button', { name: 'SessionDeleteItem' })).toBeVisible();
});

testStable('archives the exact note membership independently of permanent deletion', async () => {
  rpc.archive.mockResolvedValue(undefined);
  mount(<VersionedNote />);
  fireEvent.contextMenu(screen.getByText('Current note'), { button: 2, clientX: 80, clientY: 80 });
  await userEvent.setup().click(await screen.findByRole('menuitem', { name: 'SessionArchive' }));
  await waitFor(() =>
    expect(rpc.archive).toHaveBeenCalledExactlyOnceWith({
      sessionId: id,
      target: { kind: 'message', id: message.id },
      archived: true
    })
  );
  expect(screen.queryByRole('alertdialog')).toBeNull();
});
