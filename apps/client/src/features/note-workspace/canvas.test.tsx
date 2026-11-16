import { StudyError, noteIdSchema, chatMessageSchema } from '@study/contracts';
import { test } from '@study/testing';
import { TooltipProvider } from '@study/ui';
import { Schema } from 'effect';
import { AtomRegistry } from 'effect/reactivity';
import { useMemo } from 'react';
import { useState } from 'react';
import type { ReactNode } from 'react';

let attachmentState: typeof __MockType0.attachmentState;

let Composer: typeof __MockType1.Composer;

let composerDraft: typeof __MockType2.composerDraft;

let MessageActions: typeof __MockType3.MessageActions;

let messageActionDraft: typeof __MockType4.messageActionDraft;

import type * as __MockType0 from './attachments';
import type * as __MockType1 from './composer';
import type * as __MockType2 from './composer.queries';
import type * as __MockType3 from './message-actions';
import type * as __MockType4 from './message-actions.queries';
import type * as NoteQueries from './note-workspace.queries';
import type * as __MockType5 from './note-workspace.queries';
import type * as __MockType6 from './transformation';

let activateVersion: typeof __MockType5.activateVersion;

let ask: typeof __MockType5.ask;

let editNote: typeof __MockType5.editNote;

let reanswerNote: typeof __MockType5.reanswerNote;

let rewriteNote: typeof __MockType5.rewriteNote;

let saveNote: typeof __MockType5.saveNote;

let uploadSource: typeof __MockType5.uploadSource;

let NoteRuns: typeof __MockType6.NoteRuns;

let rpc: ReturnType<typeof createMockState>['rpc'];

const id = Schema.decodeUnknownSync(noteIdSchema)(501n);

const message = Schema.decodeUnknownSync(chatMessageSchema)({
  id: 71n,
  noteId: id,
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

const clients: AtomRegistry.AtomRegistry[] = [];

function CanvasProvider({
  rpcHandlersTransport,
  registry,
  children
}: {
  rpcHandlersTransport: test.Context['rpcHandlersTransport'];
  registry: AtomRegistry.AtomRegistry;
  children: ReactNode;
}) {
  const fixture = useMemo(
    () =>
      rpcHandlersTransport(
        {
          'sources.conversionStrategies': rpc.strategies,
          'notes.convertMessage': rpc.convert,
          'notes.message': rpc.message,
          'notes.setItemArchived': rpc.archive,
          'notes.noteSelection': async () => ({ revision: 8n, targets: [] }),
          'notes.noteGenerations': ({ before, limit }) => rpc.pages(before, limit),
          'workflows.executions': async () => ({ items: [], next: null }),
          'pages.transform': async ({ requestId }) => ({
            id: requestId,
            title: 'Retained generation title',
            instruction: '',
            contextRequestId: 'capture',
            operations: ['clarity'],
            noteId: id,
            eventId: requestId,
            errorKind: null,
            cancelled: true,
            resultVersionId: null,
            report: null
          })
        },
        registry
      ),
    [registry, rpcHandlersTransport]
  );

  return <fixture.wrapper>{children}</fixture.wrapper>;
}

function mount(
  { render, rpcHandlersTransport }: Pick<test.Context, 'render' | 'rpcHandlersTransport'>,
  node: ReactNode,
  client = AtomRegistry.make()
) {
  if (!clients.includes(client)) clients.push(client);

  return {
    client,
    ...render(
      <CanvasProvider registry={client} rpcHandlersTransport={rpcHandlersTransport}>
        {node}
      </CanvasProvider>
    )
  };
}

const actions = (versionId = message.activeVersionId!, value = message) => (
  <MessageActions message={value} versionId={versionId} onActive={() => {}} />
);

function createMockState(mock: test.Mock) {
  return {
    rpc: (() => ({
      message: mock.fn(),
      pages: mock.fn(),
      archive: mock.fn(),
      convert: mock.fn(),
      strategies: mock.fn()
    }))()
  };
}

test.beforeEach(async ({ mock }) => {
  const __mockState = createMockState(mock);

  rpc = __mockState.rpc;

  mock('#client/lib/ai-readiness.ts', () => ({ useAiReadiness: () => 'ready' }));
  mock('#client/lib/i18n.tsx', () => ({
    useI18n: () => ({ t: (key: string) => key, locale: 'english', date: String })
  }));
  mock('#client/features/document-editing/proposal-review', () => ({
    ProposalReview: ({ requestId }: { requestId: string }) => (
      <div data-testid="proposal">{requestId}</div>
    )
  }));
  mock('#client/features/note-workspace/note-workspace.queries', async (load) => {
    const actual = await load<typeof NoteQueries>();

    return {
      ...actual,
      uploadSource: mock.fn(),
      saveNote: mock.fn(),
      ask: mock.fn(),
      editNote: mock.fn(),
      rewriteNote: mock.fn(),
      reanswerNote: mock.fn(),
      activateVersion: mock.fn()
    };
  });
  const __mockModule0 = await import('./attachments');

  attachmentState = __mockModule0.attachmentState;
  const __mockModule1 = await import('./composer');

  Composer = __mockModule1.Composer;
  const __mockModule2 = await import('./composer.queries');

  composerDraft = __mockModule2.composerDraft;
  const __mockModule3 = await import('./message-actions');

  MessageActions = __mockModule3.MessageActions;
  const __mockModule4 = await import('./message-actions.queries');

  messageActionDraft = __mockModule4.messageActionDraft;
  const __mockModule5 = await import('./note-workspace.queries');

  activateVersion = __mockModule5.activateVersion;
  ask = __mockModule5.ask;
  editNote = __mockModule5.editNote;
  reanswerNote = __mockModule5.reanswerNote;
  rewriteNote = __mockModule5.rewriteNote;
  saveNote = __mockModule5.saveNote;
  uploadSource = __mockModule5.uploadSource;
  const __mockModule6 = await import('./transformation');

  NoteRuns = __mockModule6.NoteRuns;
});

test.beforeEach(({ vi }) => {
  vi.resetAllMocks();
  rpc.message.mockResolvedValue(message);
  rpc.strategies.mockResolvedValue([
    { id: 'chatgpt', name: 'ChatGPT', supportedInputs: ['text', 'pdf'] }
  ]);
  rpc.pages.mockResolvedValue({ items: [], next: null });
});
test.afterEach(({ cleanup }) => {
  cleanup();

  for (const client of clients.splice(0)) client.dispose();
});

test.stable(
  'keeps an uncertain upload across remount and never automatically creates it twice',
  async ({ vi, act, fireEvent, screen, expect, render, rpcHandlersTransport }) => {
    vi.mocked(uploadSource).mockRejectedValue(new StudyError('transient', 'Unconfirmed'));
    const first = mount({ render, rpcHandlersTransport }, <Composer id={id} />);

    await act(async () => {
      fireEvent.change(screen.getByLabelText('NoteAttachFiles'), {
        target: { files: [new File(['notes'], 'notes.txt')] }
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await screen.findByText('NoteUploadUncertain');
    expect(uploadSource).toHaveBeenCalledTimes(1);
    first.unmount();
    mount({ render, rpcHandlersTransport }, <Composer id={id} />, first.client);
    expect(screen.getByText('notes.txt')).toBeVisible();
    expect(screen.getByRole('button', { name: 'NoteSaveNote' })).toBeDisabled();
    expect(uploadSource).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  }
);

test.stable(
  'sends attachment-only notes with accepted source IDs and does not upload again on send',
  async ({ vi, act, fireEvent, screen, waitFor, expect, render, rpcHandlersTransport }) => {
    vi.mocked(uploadSource).mockResolvedValue({ id: 44n } as Awaited<
      ReturnType<typeof uploadSource>
    >);
    vi.mocked(saveNote).mockResolvedValue(message);
    mount({ render, rpcHandlersTransport }, <Composer id={id} />);
    await act(async () => {
      fireEvent.drop(screen.getByRole('region', { name: 'NoteCompose' }), {
        dataTransfer: { files: [new File(['notes'], 'notes.txt')] }
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await screen.findByText('NoteFileAccepted');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'NoteSaveNote' }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await waitFor(() => expect(saveNote).toHaveBeenCalledWith(id, '', [44n]));
    await waitFor(() => expect(screen.queryByText('notes.txt')).not.toBeInTheDocument());
    expect(uploadSource).toHaveBeenCalledTimes(1);
    expect(ask).not.toHaveBeenCalled();
  }
);

test.stable(
  'keeps upload ownership while a receipt arrives after unmount',
  async ({ vi, act, fireEvent, screen, expect, render, rpcHandlersTransport }) => {
    let accept!: (value: Awaited<ReturnType<typeof uploadSource>>) => void;

    vi.mocked(uploadSource).mockImplementation(
      () =>
        new Promise((resolve) => {
          accept = resolve;
        })
    );
    const first = mount({ render, rpcHandlersTransport }, <Composer id={id} />);

    await act(async () => {
      fireEvent.change(screen.getByLabelText('NoteAttachFiles'), {
        target: { files: [new File(['n'], 'n.txt')] }
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    first.unmount();
    mount({ render, rpcHandlersTransport }, <Composer id={id} />, first.client);
    expect(screen.getByText('NoteUploading')).toBeVisible();
    await act(async () => accept({ id: 45n } as Awaited<ReturnType<typeof uploadSource>>));
    await screen.findByText('NoteFileAccepted');
    expect(first.client.get(attachmentState(id))).toEqual([
      expect.objectContaining({ sourceId: 45n, state: 'ready' })
    ]);
    expect(uploadSource).toHaveBeenCalledTimes(1);
  }
);

test.stable(
  'retains a definite rejection and only retries after a deliberate click',
  async ({ vi, act, fireEvent, screen, expect, render, rpcHandlersTransport }) => {
    vi.mocked(uploadSource)
      .mockRejectedValueOnce(new StudyError('invalid_input', 'Unsupported'))
      .mockResolvedValueOnce({ id: 46n } as Awaited<ReturnType<typeof uploadSource>>);
    mount({ render, rpcHandlersTransport }, <Composer id={id} />);
    await act(async () => {
      fireEvent.change(screen.getByLabelText('NoteAttachFiles'), {
        target: { files: [new File(['n'], 'n.txt')] }
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await screen.findByText('NoteFileRejected');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await screen.findByText('NoteFileAccepted');
    expect(uploadSource).toHaveBeenCalledTimes(2);
  }
);

test.stable.for([
  ['NoteImprove', 'improve'],
  ['NoteSummarize', 'summarize']
] as const)(
  'targets the exact message for %s and retains its request receipt',
  async (
    [label, origin],
    { vi, act, fireEvent, screen, expect, waitFor, render, rpcHandlersTransport }
  ) => {
    vi.mocked(rewriteNote).mockResolvedValue({
      requestId: 'rewrite-exact',
      noteId: id,
      messageId: message.id,
      versionId: message.activeVersionId!
    });
    mount({ render, rpcHandlersTransport }, actions());
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: label }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(screen.getByText(/^NoteItemTransformScope/)).toBeVisible();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'NoteApplyAction' }));
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

test.stable(
  'keeps the edit payload and write fence across remounts until the original receipt',
  async ({
    vi,
    act,
    fireEvent,
    screen,
    userEvent,
    waitFor,
    expect,
    render,
    rpcHandlersTransport
  }) => {
    let accept!: (value: typeof message) => void;

    vi.mocked(editNote).mockImplementation(
      () =>
        new Promise((resolve) => {
          accept = resolve;
        })
    );
    const first = mount({ render, rpcHandlersTransport }, actions());

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'NoteEditNote' }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await act(async () => {
      const input = screen.getByRole('textbox');

      await userEvent.clear(input);
      await userEvent.type(input, 'Edited note', { skipClick: true });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'NoteSaveNote' }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await waitFor(() =>
      expect(editNote).toHaveBeenCalledWith({ messageId: message.id, text: 'Edited note' })
    );
    first.unmount();
    mount({ render, rpcHandlersTransport }, actions(), first.client);
    expect(screen.getByRole('button', { name: 'NoteSaveNote' })).toBeDisabled();
    await act(async () => accept(message));
    await waitFor(() => expect(screen.queryByRole('textbox')).not.toBeInTheDocument());
    expect(editNote).toHaveBeenCalledTimes(1);
  }
);

test.stable(
  'does not rewrite a changed active version or silently use a historical version',
  async ({ act, fireEvent, screen, expect, render, rpcHandlersTransport }) => {
    rpc.message.mockResolvedValue({ ...message, activeVersionId: message.versions[0]!.id });
    mount({ render, rpcHandlersTransport }, actions());
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'NoteImprove', hidden: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'NoteApplyAction' }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await screen.findByRole('alert');
    expect(rewriteNote).not.toHaveBeenCalled();
  }
);

test.stable(
  'offers explicit historical activation and sends setActiveVersion with its exact identity',
  async ({ vi, expect, screen, act, fireEvent, waitFor, render, rpcHandlersTransport }) => {
    vi.mocked(activateVersion).mockResolvedValue(message);
    mount({ render, rpcHandlersTransport }, actions(message.versions[0]!.id));
    expect(screen.getByRole('button', { name: 'NoteImprove', hidden: true })).toBeDisabled();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'NoteUseVersion' }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'NoteApplyAction' }));
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

test.stable(
  'never replays a rewrite after uncertain acceptance and remount',
  async ({ vi, act, fireEvent, screen, expect, render, rpcHandlersTransport }) => {
    vi.mocked(rewriteNote).mockRejectedValue(new StudyError('transient', 'Unconfirmed'));
    const first = mount({ render, rpcHandlersTransport }, actions());

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'NoteImprove', hidden: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'NoteApplyAction' }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await screen.findByText('NoteItemActionUncertain');
    first.unmount();
    mount({ render, rpcHandlersTransport }, actions(), first.client);
    expect(screen.getByRole('button', { name: 'NoteImprove', hidden: true })).toBeDisabled();
    expect(rewriteNote).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  }
);

test.stable(
  'sends custom instructions only to the chosen message',
  async ({ vi, act, fireEvent, screen, waitFor, expect, render, rpcHandlersTransport }) => {
    vi.mocked(rewriteNote).mockResolvedValue({
      requestId: 'custom',
      noteId: id,
      messageId: message.id,
      versionId: message.activeVersionId!
    });
    mount({ render, rpcHandlersTransport }, actions());
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'NoteCustomTransform', hidden: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await act(async () => {
      fireEvent.change(screen.getByRole('textbox'), {
        target: { value: 'Use shorter sentences' }
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'NoteApplyAction' }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await waitFor(() =>
      expect(rewriteNote).toHaveBeenCalledWith({
        messageId: message.id,
        origin: 'instruction',
        instruction: 'Use shorter sentences'
      })
    );
  }
);

test.stable(
  'offers editing actions without Ask or Reanswer for existing entries',
  ({ expect, screen, render, rpcHandlersTransport }) => {
    const assistant = { ...message, role: 'assistant' as const, replyTo: message.id };

    mount({ render, rpcHandlersTransport }, actions(message.activeVersionId!, assistant));
    expect(screen.queryByRole('button', { name: 'NoteAsk' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'NoteReanswer' })).toBeNull();
    expect(screen.getByRole('button', { name: 'NoteImprove', hidden: true })).toBeVisible();
    expect(reanswerNote).not.toHaveBeenCalled();
    expect(ask).not.toHaveBeenCalled();
  }
);

test.stable(
  'retains exact retry identity for an Ask operation already stored before the capture-only UI',
  async ({ vi, expect, screen, fireEvent, waitFor, render, rpcHandlersTransport }) => {
    vi.mocked(ask).mockResolvedValue({ requestId: 'ask-exact' } as Awaited<ReturnType<typeof ask>>);
    const client = AtomRegistry.make();
    const input = {
      noteId: id,
      expectedSelectionRevision: 8n,
      intentKey: 'retained-quoted-ask',
      text: 'Why is this true?',
      instruction: JSON.stringify({
        targetMessageId: '71',
        targetVersionId: '81',
        targetText: 'Current note'
      })
    };

    client.set(messageActionDraft(id, message.id), {
      text: '',
      instruction: '',
      error: new StudyError('transient', 'Unconfirmed'),
      attempt: {
        action: 'ask',
        versionId: message.versions[1]!.id,
        text: '',
        instruction: '',
        askInput: input
      }
    });
    const first = mount({ render, rpcHandlersTransport }, actions(), client);

    expect(screen.queryByRole('button', { name: 'NoteAsk' })).toBeNull();
    first.unmount();
    mount({ render, rpcHandlersTransport }, actions(), client);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(ask).toHaveBeenCalledExactlyOnceWith(input));
    expect(saveNote).not.toHaveBeenCalled();
  }
);

test.stable(
  'discovers canonical runs on a cold mount, paginates exact cursors, and mounts only retained proposals',
  async ({ expect, screen, act, fireEvent, render, rpcHandlersTransport }) => {
    const run = {
      requestId: 'request-z',
      contextRequestId: null,
      state: 'available',
      cancelled: false,
      resultVersionId: null,
      proposedVersionId: 90n,
      baseVersionId: 89n
    };

    rpc.pages.mockImplementation((before, limit) =>
      Promise.resolve(
        before || limit > 30
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
    mount({ render, rpcHandlersTransport }, <NoteRuns id={id} />);
    expect(await screen.findByTestId('proposal')).toHaveTextContent('request-z');
    expect(screen.getAllByText('NoteContextUnavailable')[0]).toBeVisible();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'LibraryMore' }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await screen.findAllByText('NoteRunRetired');
    expect(rpc.pages).toHaveBeenCalledWith(undefined, 60);
    expect(screen.queryByTestId('proposal')).toBeNull();
  }
);

test.stable(
  'captures accepted files and plain text together without requesting a reply',
  async ({ vi, fireEvent, screen, expect, waitFor, render, rpcHandlersTransport }) => {
    vi.mocked(uploadSource).mockResolvedValue({ id: 47n } as Awaited<
      ReturnType<typeof uploadSource>
    >);
    vi.mocked(saveNote).mockResolvedValue(message);
    mount({ render, rpcHandlersTransport }, <Composer id={id} />);
    fireEvent.change(screen.getByLabelText('NoteAttachFiles'), {
      target: { files: [new File(['n'], 'n.txt')] }
    });
    await screen.findByText('NoteFileAccepted');
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'Keep this with the lecture' }
    });
    expect(screen.queryByRole('button', { name: 'NoteAsk' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'NoteSaveNote' }));
    await waitFor(() =>
      expect(saveNote).toHaveBeenCalledExactlyOnceWith(id, 'Keep this with the lecture', [47n])
    );
    expect(ask).not.toHaveBeenCalled();
    expect(uploadSource).toHaveBeenCalledTimes(1);
  }
);

test.stable(
  'keeps the original note and source payload after an uncertain post without replay',
  async ({ vi, act, fireEvent, screen, expect, render, rpcHandlersTransport }) => {
    vi.mocked(uploadSource).mockResolvedValue({ id: 48n } as Awaited<
      ReturnType<typeof uploadSource>
    >);
    vi.mocked(saveNote).mockRejectedValue(new StudyError('transient', 'Unconfirmed'));
    const first = mount({ render, rpcHandlersTransport }, <Composer id={id} />);

    await act(async () => {
      fireEvent.change(screen.getByLabelText('NoteAttachFiles'), {
        target: { files: [new File(['n'], 'n.txt')] }
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await screen.findByText('NoteFileAccepted');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'NoteSaveNote' }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await screen.findByText('NoteNoteUncertain');
    first.unmount();
    mount({ render, rpcHandlersTransport }, <Composer id={id} />, first.client);
    expect(first.client.get(composerDraft(id))).toMatchObject({
      noteAttempt: '',
      noteSourceIds: [48n]
    });
    expect(screen.getByRole('button', { name: 'NoteSaveNote' })).toBeDisabled();
    expect(saveNote).toHaveBeenCalledTimes(1);
    expect(uploadSource).toHaveBeenCalledTimes(1);
  }
);

test.stable(
  'hands focus to the item editor and restores the invoking action on cancel',
  async ({ screen, act, fireEvent, waitFor, expect, render, rpcHandlersTransport }) => {
    mount({ render, rpcHandlersTransport }, actions());
    const trigger = screen.getByRole('button', { name: 'NoteEditNote' });

    trigger.focus();
    await act(async () => {
      fireEvent.click(trigger);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'NoteEditNote' })).toHaveFocus()
    );
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'NoteCancel' }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(trigger).toHaveFocus();
    expect(screen.queryByRole('button', { name: 'NoteVersions' })).toBeNull();
  }
);

test.stable(
  'keeps editing actions disabled on a historical version',
  ({ expect, screen, render, rpcHandlersTransport }) => {
    mount({ render, rpcHandlersTransport }, actions(message.versions[0]!.id));
    expect(screen.getByRole('button', { name: 'NoteEditNote' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'NoteImprove', hidden: true })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'NoteUseVersion' })).toBeEnabled();
  }
);

test.stable(
  'puts the saved task title above technical run details without inventing a date',
  async ({ expect, screen, render, rpcHandlersTransport }) => {
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
    mount({ render, rpcHandlersTransport }, <NoteRuns id={id} />);
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

test.stable(
  'browses exact saved versions with inline boundaries and a Latest badge without activating them',
  async ({ expect, screen, fireEvent, render, rpcHandlersTransport }) => {
    mount({ render, rpcHandlersTransport }, <VersionedNote />);
    expect(screen.getByRole('button', { name: 'NoteNextVersion' })).toBeDisabled();
    expect(screen.getByText('NoteVersionLatest')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'NotePreviousVersion' }));
    expect(screen.getByText('Historical note')).toBeVisible();
    expect(screen.getByText('1', { selector: '[role="status"]' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'NotePreviousVersion' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'NoteUseVersion' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'NoteNextVersion' }));
    expect(screen.getByText('Current note')).toBeVisible();
    expect(screen.getByText('NoteVersionLatest')).toBeVisible();
    expect(activateVersion).not.toHaveBeenCalled();
  }
);

test.stable(
  'keeps version browsing disabled while an edit or uncertain write owns the note and restores it after review',
  async ({ vi, fireEvent, screen, waitFor, expect, render, rpcHandlersTransport }) => {
    vi.mocked(editNote).mockRejectedValue(new StudyError('transient', 'Uncertain edit'));
    mount({ render, rpcHandlersTransport }, <VersionedNote />);
    fireEvent.click(screen.getByRole('button', { name: 'NoteEditNote' }));
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'NotePreviousVersion', hidden: true })
      ).toBeDisabled()
    );
    fireEvent.click(screen.getByRole('button', { name: 'NoteCancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'NotePreviousVersion', hidden: true })
      ).toBeEnabled()
    );
    fireEvent.click(screen.getByRole('button', { name: 'NoteEditNote' }));
    fireEvent.click(await screen.findByRole('button', { name: 'NoteSaveNote' }));
    await screen.findByRole('alert');
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'NotePreviousVersion', hidden: true })
      ).toBeDisabled()
    );
    fireEvent.click(screen.getByRole('button', { name: 'LibraryRefresh' }));
    fireEvent.click(await screen.findByRole('button', { name: 'NoteReviewedHistory' }));
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'NotePreviousVersion', hidden: true })
      ).toBeEnabled()
    );
  }
);

test.stable(
  'labels the newest saved version Latest even when another version is active',
  ({ expect, screen, fireEvent, render, rpcHandlersTransport }) => {
    mount(
      { render, rpcHandlersTransport },
      <VersionedNote
        value={{
          ...message,
          activeVersionId: message.versions[0]!.id,
          versions: [...message.versions].reverse()
        }}
      />
    );
    expect(screen.getByText('1', { selector: '[role="status"]' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'NoteNextVersion' }));
    expect(screen.getByText('NoteVersionLatest')).toBeVisible();
    expect(screen.getByRole('button', { name: 'NoteUseVersion' })).toBeEnabled();
    expect(activateVersion).not.toHaveBeenCalled();
  }
);

test.stable(
  'retains the same action controls while browsing saved versions',
  ({ screen, expect, fireEvent, render, rpcHandlersTransport }) => {
    mount({ render, rpcHandlersTransport }, <VersionedNote />);
    const edit = screen.getByRole('button', { name: 'NoteEditNote' });
    const improve = screen.getByRole('button', { name: 'NoteImprove', hidden: true });
    const activate = screen.getByRole('button', { name: 'NoteUseVersion' });

    expect(activate).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'NotePreviousVersion' }));
    expect(screen.getByRole('button', { name: 'NoteEditNote' })).toBe(edit);
    expect(screen.getByRole('button', { name: 'NoteImprove', hidden: true })).toBe(improve);
    expect(screen.getByRole('button', { name: 'NoteUseVersion' })).toBe(activate);
    expect(edit).toBeDisabled();
    expect(improve).toBeDisabled();
    expect(activate).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'NoteNextVersion' }));
    expect(edit).toBeEnabled();
    expect(improve).toBeEnabled();
    expect(activate).toBeDisabled();
  }
);

test.stable(
  'protects an open edit from other toolbar actions',
  async ({ fireEvent, screen, waitFor, expect, render, rpcHandlersTransport }) => {
    mount({ render, rpcHandlersTransport }, <VersionedNote />);
    fireEvent.click(screen.getByRole('button', { name: 'NoteEditNote' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'NoteImprove', hidden: true })).toBeDisabled()
    );
    expect(
      screen.getByRole('button', { name: 'NoteCustomTransform', hidden: true })
    ).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'NoteCancel' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'NoteImprove', hidden: true })).toBeEnabled()
    );
  }
);

test.stable(
  'opens deliberate editing in a dialog while keeping the saved note in the notebook',
  async ({ fireEvent, screen, expect, waitFor, render, rpcHandlersTransport }) => {
    mount({ render, rpcHandlersTransport }, <VersionedNote />);
    fireEvent.click(screen.getByRole('button', { name: 'NoteEditNote' }));
    expect(await screen.findByRole('dialog', { name: 'NoteEditNote' })).toBeVisible();
    expect(screen.getByText('Current note', { selector: 'p' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'NoteCancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(editNote).not.toHaveBeenCalled();
  }
);

test.stable(
  'opens note actions on right click and edits the exact selected note',
  async ({ fireEvent, screen, userEvent, expect, render, rpcHandlersTransport }) => {
    mount({ render, rpcHandlersTransport }, <VersionedNote />);
    fireEvent.contextMenu(screen.getByText('Current note'), {
      button: 2,
      clientX: 80,
      clientY: 80
    });
    await userEvent.setup().click(await screen.findByRole('menuitem', { name: 'NoteEditNote' }));
    expect(await screen.findByRole('dialog')).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'NoteEditNote' })).toHaveValue('Current note');
    expect(editNote).not.toHaveBeenCalled();
  }
);

test.stable(
  'restricts historical note context actions to activating the selected version',
  async ({ fireEvent, screen, expect, userEvent, render, rpcHandlersTransport }) => {
    mount({ render, rpcHandlersTransport }, <VersionedNote />);
    fireEvent.click(screen.getByRole('button', { name: 'NotePreviousVersion' }));
    fireEvent.contextMenu(screen.getByText('Historical note'), {
      button: 2,
      clientX: 80,
      clientY: 80
    });
    expect(await screen.findByRole('menuitem', { name: 'NoteImprove' })).toHaveAttribute(
      'aria-disabled',
      'true'
    );
    expect(screen.getByRole('menuitem', { name: 'NoteEditNote' })).toHaveAttribute(
      'aria-disabled',
      'true'
    );
    await userEvent.setup().click(screen.getByRole('menuitem', { name: 'NoteUseVersion' }));
    expect(await screen.findByRole('dialog')).toBeVisible();
    expect(screen.getByRole('dialog')).toHaveTextContent('Historical note');
    expect(activateVersion).not.toHaveBeenCalled();
  }
);

test.stable(
  'keeps pending assistant message context actions disabled and hides note editing',
  async ({ fireEvent, screen, expect, render, rpcHandlersTransport }) => {
    const pending = {
      ...message,
      role: 'assistant' as const,
      versions: message.versions.map((version) => ({ ...version, status: 'pending' as const }))
    };

    mount({ render, rpcHandlersTransport }, <VersionedNote value={pending} />);
    fireEvent.contextMenu(screen.getByText('Current note'), {
      button: 2,
      clientX: 80,
      clientY: 80
    });
    expect(await screen.findByRole('menuitem', { name: 'NoteImprove' })).toHaveAttribute(
      'aria-disabled',
      'true'
    );
    expect(screen.queryByRole('menuitem', { name: 'NoteEditNote' })).toBeNull();
  }
);

test.stable(
  'keeps raw note deletion in both the toolbar and right-click menu',
  async ({
    expect,
    screen,
    fireEvent,
    userEvent,
    within,
    waitFor,
    render,
    rpcHandlersTransport
  }) => {
    mount({ render, rpcHandlersTransport }, <VersionedNote />);
    expect(screen.getByRole('button', { name: 'NoteDeleteItem' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'NoteDeleteVersion' })).toBeVisible();
    fireEvent.contextMenu(screen.getByText('Current note'), {
      button: 2,
      clientX: 80,
      clientY: 80
    });
    expect(await screen.findByRole('menuitem', { name: 'NoteDeleteItem' })).toBeVisible();
    await userEvent.setup().click(screen.getByRole('menuitem', { name: 'NoteDeleteVersion' }));
    const dialog = await screen.findByRole('alertdialog');

    expect(within(dialog).getByText('NoteDeleteVersionHelp')).toBeVisible();
    await userEvent.setup().click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'NoteDeleteItem' })).toBeVisible();
  }
);

test.stable(
  'archives the exact note membership independently of permanent deletion',
  async ({ fireEvent, screen, userEvent, waitFor, expect, render, rpcHandlersTransport }) => {
    rpc.archive.mockResolvedValue(undefined);
    mount({ render, rpcHandlersTransport }, <VersionedNote />);
    fireEvent.contextMenu(screen.getByText('Current note'), {
      button: 2,
      clientX: 80,
      clientY: 80
    });
    await userEvent.setup().click(await screen.findByRole('menuitem', { name: 'NoteArchive' }));
    await waitFor(() =>
      expect(rpc.archive).toHaveBeenCalledExactlyOnceWith({
        noteId: id,
        target: { kind: 'message', id: message.id },
        archived: true
      })
    );
    expect(screen.queryByRole('alertdialog')).toBeNull();
  }
);

test.stable(
  'converts the selected active message version directly from its toolbar',
  async ({ fireEvent, screen, waitFor, expect, render, rpcHandlersTransport }) => {
    rpc.convert.mockResolvedValue({
      requestId: 'converted',
      noteId: id,
      messageId: message.id,
      versionId: 99n
    });
    mount({ render, rpcHandlersTransport }, actions());
    fireEvent.click(await screen.findByRole('button', { name: 'NoteConvertText' }));
    await waitFor(() =>
      expect(rpc.convert).toHaveBeenCalledWith({
        messageId: message.id,
        expectedActiveVersionId: message.activeVersionId,
        strategyId: 'chatgpt'
      })
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  }
);

test.stable(
  'retries the original conversion payload after viewing another version',
  async ({ fireEvent, screen, waitFor, expect, render, rpcHandlersTransport }) => {
    rpc.convert
      .mockRejectedValueOnce(new StudyError('transient', 'Unconfirmed'))
      .mockResolvedValueOnce({
        requestId: 'converted',
        noteId: id,
        messageId: message.id,
        versionId: 99n
      });
    const view = mount({ render, rpcHandlersTransport }, actions());

    fireEvent.click(await screen.findByRole('button', { name: 'NoteConvertText' }));
    await screen.findByRole('button', { name: 'Retry' });
    view.rerender(
      <CanvasProvider registry={view.client} rpcHandlersTransport={rpcHandlersTransport}>
        {actions(message.versions[0].id)}
      </CanvasProvider>
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(rpc.convert).toHaveBeenCalledTimes(2));
    expect(rpc.convert.mock.calls[1][0]).toEqual(rpc.convert.mock.calls[0][0]);
  }
);

test.stable.for(['Copied text', ''])(
  'pasting files retains the clipboard text payload %j',
  async (text, { vi, fireEvent, screen, expect, waitFor, render, rpcHandlersTransport }) => {
    const file = new File(['pdf'], 'pasted.pdf', { type: 'application/pdf' });

    vi.mocked(uploadSource).mockResolvedValue({ id: 47n } as Awaited<
      ReturnType<typeof uploadSource>
    >);
    mount({ render, rpcHandlersTransport }, <Composer id={id} />);
    const accepted = fireEvent.paste(screen.getByRole('textbox'), {
      clipboardData: {
        files: [file],
        getData: (kind: string) => (kind === 'text/plain' ? text : '')
      }
    });

    expect(accepted).toBe(!!text);
    await waitFor(() => expect(uploadSource).toHaveBeenCalledWith(file));
  }
);

test.stable(
  'identifies the conversion icon on hover',
  async ({ userEvent, screen, expect, render, rpcHandlersTransport }) => {
    const user = userEvent.setup();

    mount(
      { render, rpcHandlersTransport },
      <TooltipProvider delay={0}>{actions()}</TooltipProvider>
    );
    await user.hover(await screen.findByRole('button', { name: 'NoteConvertText' }));
    expect(await screen.findByRole('tooltip')).toHaveTextContent('NoteConvertText');
  }
);
