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
  registry,
  children
}: {
  registry: AtomRegistry.AtomRegistry;
  children: ReactNode;
}) {
  const fixture = useMemo(
    () =>
      test.rpcHandlersTransport(
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
    [registry]
  );

  return <fixture.wrapper>{children}</fixture.wrapper>;
}

function mount(node: ReactNode, client = AtomRegistry.make()) {
  if (!clients.includes(client)) clients.push(client);

  return { client, ...test.render(<CanvasProvider registry={client}>{node}</CanvasProvider>) };
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

test.beforeEach(() => {
  test.vi.resetAllMocks();
  rpc.message.mockResolvedValue(message);
  rpc.strategies.mockResolvedValue([
    { id: 'chatgpt', name: 'ChatGPT', supportedInputs: ['text', 'pdf'] }
  ]);
  rpc.pages.mockResolvedValue({ items: [], next: null });
});
test.afterEach(() => {
  test.cleanup();

  for (const client of clients.splice(0)) client.dispose();
});

test.stable(
  'keeps an uncertain upload across remount and never automatically creates it twice',
  async () => {
    test.vi.mocked(uploadSource).mockRejectedValue(new StudyError('transient', 'Unconfirmed'));
    const first = mount(<Composer id={id} />);

    await test.act(async () => {
      test.fireEvent.change(test.screen.getByLabelText('NoteAttachFiles'), {
        target: { files: [new File(['notes'], 'notes.txt')] }
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await test.screen.findByText('NoteUploadUncertain');
    test.expect(uploadSource).toHaveBeenCalledTimes(1);
    first.unmount();
    mount(<Composer id={id} />, first.client);
    test.expect(test.screen.getByText('notes.txt')).toBeVisible();
    test.expect(test.screen.getByRole('button', { name: 'NoteSaveNote' })).toBeDisabled();
    test.expect(uploadSource).toHaveBeenCalledTimes(1);
    test.expect(test.screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  }
);

test.stable(
  'sends attachment-only notes with accepted source IDs and does not upload again on send',
  async () => {
    test.vi
      .mocked(uploadSource)
      .mockResolvedValue({ id: 44n } as Awaited<ReturnType<typeof uploadSource>>);
    test.vi.mocked(saveNote).mockResolvedValue(message);
    mount(<Composer id={id} />);
    await test.act(async () => {
      test.fireEvent.drop(test.screen.getByRole('region', { name: 'NoteCompose' }), {
        dataTransfer: { files: [new File(['notes'], 'notes.txt')] }
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await test.screen.findByText('NoteFileAccepted');
    await test.act(async () => {
      test.fireEvent.click(test.screen.getByRole('button', { name: 'NoteSaveNote' }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await test.waitFor(() => test.expect(saveNote).toHaveBeenCalledWith(id, '', [44n]));
    await test.waitFor(() =>
      test.expect(test.screen.queryByText('notes.txt')).not.toBeInTheDocument()
    );
    test.expect(uploadSource).toHaveBeenCalledTimes(1);
    test.expect(ask).not.toHaveBeenCalled();
  }
);

test.stable('keeps upload ownership while a receipt arrives after unmount', async () => {
  let accept!: (value: Awaited<ReturnType<typeof uploadSource>>) => void;

  test.vi.mocked(uploadSource).mockImplementation(
    () =>
      new Promise((resolve) => {
        accept = resolve;
      })
  );
  const first = mount(<Composer id={id} />);

  await test.act(async () => {
    test.fireEvent.change(test.screen.getByLabelText('NoteAttachFiles'), {
      target: { files: [new File(['n'], 'n.txt')] }
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  first.unmount();
  mount(<Composer id={id} />, first.client);
  test.expect(test.screen.getByText('NoteUploading')).toBeVisible();
  await test.act(async () => accept({ id: 45n } as Awaited<ReturnType<typeof uploadSource>>));
  await test.screen.findByText('NoteFileAccepted');
  test
    .expect(first.client.get(attachmentState(id)))
    .toEqual([test.expect.objectContaining({ sourceId: 45n, state: 'ready' })]);
  test.expect(uploadSource).toHaveBeenCalledTimes(1);
});

test.stable('retains a definite rejection and only retries after a deliberate click', async () => {
  test.vi
    .mocked(uploadSource)
    .mockRejectedValueOnce(new StudyError('invalid_input', 'Unsupported'))
    .mockResolvedValueOnce({ id: 46n } as Awaited<ReturnType<typeof uploadSource>>);
  mount(<Composer id={id} />);
  await test.act(async () => {
    test.fireEvent.change(test.screen.getByLabelText('NoteAttachFiles'), {
      target: { files: [new File(['n'], 'n.txt')] }
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  await test.screen.findByText('NoteFileRejected');
  await test.act(async () => {
    test.fireEvent.click(test.screen.getByRole('button', { name: 'Retry' }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  await test.screen.findByText('NoteFileAccepted');
  test.expect(uploadSource).toHaveBeenCalledTimes(2);
});

test.stable.each([
  ['NoteImprove', 'improve'],
  ['NoteSummarize', 'summarize']
] as const)(
  'targets the exact message for %s and retains its request receipt',
  async (label, origin) => {
    test.vi.mocked(rewriteNote).mockResolvedValue({
      requestId: 'rewrite-exact',
      noteId: id,
      messageId: message.id,
      versionId: message.activeVersionId!
    });
    mount(actions());
    await test.act(async () => {
      test.fireEvent.click(test.screen.getByRole('button', { name: label }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    test.expect(test.screen.getByText(/^NoteItemTransformScope/)).toBeVisible();
    await test.act(async () => {
      test.fireEvent.click(test.screen.getByRole('button', { name: 'NoteApplyAction' }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await test.waitFor(() =>
      test.expect(rewriteNote).toHaveBeenCalledWith({
        messageId: message.id,
        origin,
        instruction: undefined
      })
    );
  }
);

test.stable(
  'keeps the edit payload and write fence across remounts until the original receipt',
  async () => {
    let accept!: (value: typeof message) => void;

    test.vi.mocked(editNote).mockImplementation(
      () =>
        new Promise((resolve) => {
          accept = resolve;
        })
    );
    const first = mount(actions());

    await test.act(async () => {
      test.fireEvent.click(test.screen.getByRole('button', { name: 'NoteEditNote' }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await test.act(async () => {
      const input = test.screen.getByRole('textbox');

      await test.userEvent.clear(input);
      await test.userEvent.type(input, 'Edited note', { skipClick: true });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await test.act(async () => {
      test.fireEvent.click(test.screen.getByRole('button', { name: 'NoteSaveNote' }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await test.waitFor(() =>
      test.expect(editNote).toHaveBeenCalledWith({ messageId: message.id, text: 'Edited note' })
    );
    first.unmount();
    mount(actions(), first.client);
    test.expect(test.screen.getByRole('button', { name: 'NoteSaveNote' })).toBeDisabled();
    await test.act(async () => accept(message));
    await test.waitFor(() =>
      test.expect(test.screen.queryByRole('textbox')).not.toBeInTheDocument()
    );
    test.expect(editNote).toHaveBeenCalledTimes(1);
  }
);

test.stable(
  'does not rewrite a changed active version or silently use a historical version',
  async () => {
    rpc.message.mockResolvedValue({ ...message, activeVersionId: message.versions[0]!.id });
    mount(actions());
    await test.act(async () => {
      test.fireEvent.click(test.screen.getByRole('button', { name: 'NoteImprove', hidden: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await test.act(async () => {
      test.fireEvent.click(test.screen.getByRole('button', { name: 'NoteApplyAction' }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await test.screen.findByRole('alert');
    test.expect(rewriteNote).not.toHaveBeenCalled();
  }
);

test.stable(
  'offers explicit historical activation and sends setActiveVersion with its exact identity',
  async () => {
    test.vi.mocked(activateVersion).mockResolvedValue(message);
    mount(actions(message.versions[0]!.id));
    test
      .expect(test.screen.getByRole('button', { name: 'NoteImprove', hidden: true }))
      .toBeDisabled();
    await test.act(async () => {
      test.fireEvent.click(test.screen.getByRole('button', { name: 'NoteUseVersion' }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await test.act(async () => {
      test.fireEvent.click(test.screen.getByRole('button', { name: 'NoteApplyAction' }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await test.waitFor(() =>
      test.expect(activateVersion).toHaveBeenCalledWith({
        messageId: message.id,
        versionId: message.versions[0]!.id
      })
    );
  }
);

test.stable('never replays a rewrite after uncertain acceptance and remount', async () => {
  test.vi.mocked(rewriteNote).mockRejectedValue(new StudyError('transient', 'Unconfirmed'));
  const first = mount(actions());

  await test.act(async () => {
    test.fireEvent.click(test.screen.getByRole('button', { name: 'NoteImprove', hidden: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  await test.act(async () => {
    test.fireEvent.click(test.screen.getByRole('button', { name: 'NoteApplyAction' }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  await test.screen.findByText('NoteItemActionUncertain');
  first.unmount();
  mount(actions(), first.client);
  test
    .expect(test.screen.getByRole('button', { name: 'NoteImprove', hidden: true }))
    .toBeDisabled();
  test.expect(rewriteNote).toHaveBeenCalledTimes(1);
  test.expect(test.screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
});

test.stable('sends custom instructions only to the chosen message', async () => {
  test.vi.mocked(rewriteNote).mockResolvedValue({
    requestId: 'custom',
    noteId: id,
    messageId: message.id,
    versionId: message.activeVersionId!
  });
  mount(actions());
  await test.act(async () => {
    test.fireEvent.click(
      test.screen.getByRole('button', { name: 'NoteCustomTransform', hidden: true })
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  await test.act(async () => {
    test.fireEvent.change(test.screen.getByRole('textbox'), {
      target: { value: 'Use shorter sentences' }
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  await test.act(async () => {
    test.fireEvent.click(test.screen.getByRole('button', { name: 'NoteApplyAction' }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  await test.waitFor(() =>
    test.expect(rewriteNote).toHaveBeenCalledWith({
      messageId: message.id,
      origin: 'instruction',
      instruction: 'Use shorter sentences'
    })
  );
});

test.stable('offers editing actions without Ask or Reanswer for existing entries', () => {
  const assistant = { ...message, role: 'assistant' as const, replyTo: message.id };

  mount(actions(message.activeVersionId!, assistant));
  test.expect(test.screen.queryByRole('button', { name: 'NoteAsk' })).toBeNull();
  test.expect(test.screen.queryByRole('button', { name: 'NoteReanswer' })).toBeNull();
  test.expect(test.screen.getByRole('button', { name: 'NoteImprove', hidden: true })).toBeVisible();
  test.expect(reanswerNote).not.toHaveBeenCalled();
  test.expect(ask).not.toHaveBeenCalled();
});

test.stable(
  'retains exact retry identity for an Ask operation already stored before the capture-only UI',
  async () => {
    test.vi
      .mocked(ask)
      .mockResolvedValue({ requestId: 'ask-exact' } as Awaited<ReturnType<typeof ask>>);
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
    const first = mount(actions(), client);

    test.expect(test.screen.queryByRole('button', { name: 'NoteAsk' })).toBeNull();
    first.unmount();
    mount(actions(), client);
    test.fireEvent.click(test.screen.getByRole('button', { name: 'Retry' }));
    await test.waitFor(() => test.expect(ask).toHaveBeenCalledExactlyOnceWith(input));
    test.expect(saveNote).not.toHaveBeenCalled();
  }
);

test.stable(
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
    mount(<NoteRuns id={id} />);
    test.expect(await test.screen.findByTestId('proposal')).toHaveTextContent('request-z');
    test.expect(test.screen.getAllByText('NoteContextUnavailable')[0]).toBeVisible();
    await test.act(async () => {
      test.fireEvent.click(test.screen.getByRole('button', { name: 'LibraryMore' }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await test.screen.findAllByText('NoteRunRetired');
    test.expect(rpc.pages).toHaveBeenCalledWith(undefined, 60);
    test.expect(test.screen.queryByTestId('proposal')).toBeNull();
  }
);

test.stable(
  'captures accepted files and plain text together without requesting a reply',
  async () => {
    test.vi
      .mocked(uploadSource)
      .mockResolvedValue({ id: 47n } as Awaited<ReturnType<typeof uploadSource>>);
    test.vi.mocked(saveNote).mockResolvedValue(message);
    mount(<Composer id={id} />);
    test.fireEvent.change(test.screen.getByLabelText('NoteAttachFiles'), {
      target: { files: [new File(['n'], 'n.txt')] }
    });
    await test.screen.findByText('NoteFileAccepted');
    test.fireEvent.change(test.screen.getByRole('textbox'), {
      target: { value: 'Keep this with the lecture' }
    });
    test.expect(test.screen.queryByRole('button', { name: 'NoteAsk' })).toBeNull();
    test.fireEvent.click(test.screen.getByRole('button', { name: 'NoteSaveNote' }));
    await test.waitFor(() =>
      test.expect(saveNote).toHaveBeenCalledExactlyOnceWith(id, 'Keep this with the lecture', [47n])
    );
    test.expect(ask).not.toHaveBeenCalled();
    test.expect(uploadSource).toHaveBeenCalledTimes(1);
  }
);

test.stable(
  'keeps the original note and source payload after an uncertain post without replay',
  async () => {
    test.vi
      .mocked(uploadSource)
      .mockResolvedValue({ id: 48n } as Awaited<ReturnType<typeof uploadSource>>);
    test.vi.mocked(saveNote).mockRejectedValue(new StudyError('transient', 'Unconfirmed'));
    const first = mount(<Composer id={id} />);

    await test.act(async () => {
      test.fireEvent.change(test.screen.getByLabelText('NoteAttachFiles'), {
        target: { files: [new File(['n'], 'n.txt')] }
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await test.screen.findByText('NoteFileAccepted');
    await test.act(async () => {
      test.fireEvent.click(test.screen.getByRole('button', { name: 'NoteSaveNote' }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await test.screen.findByText('NoteNoteUncertain');
    first.unmount();
    mount(<Composer id={id} />, first.client);
    test.expect(first.client.get(composerDraft(id))).toMatchObject({
      noteAttempt: '',
      noteSourceIds: [48n]
    });
    test.expect(test.screen.getByRole('button', { name: 'NoteSaveNote' })).toBeDisabled();
    test.expect(saveNote).toHaveBeenCalledTimes(1);
    test.expect(uploadSource).toHaveBeenCalledTimes(1);
  }
);

test.stable(
  'hands focus to the item editor and restores the invoking action on cancel',
  async () => {
    mount(actions());
    const trigger = test.screen.getByRole('button', { name: 'NoteEditNote' });

    trigger.focus();
    await test.act(async () => {
      test.fireEvent.click(trigger);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await test.waitFor(() =>
      test.expect(test.screen.getByRole('textbox', { name: 'NoteEditNote' })).toHaveFocus()
    );
    await test.act(async () => {
      test.fireEvent.click(test.screen.getByRole('button', { name: 'NoteCancel' }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    test.expect(trigger).toHaveFocus();
    test.expect(test.screen.queryByRole('button', { name: 'NoteVersions' })).toBeNull();
  }
);

test.stable('keeps editing actions disabled on a historical version', () => {
  mount(actions(message.versions[0]!.id));
  test.expect(test.screen.getByRole('button', { name: 'NoteEditNote' })).toBeDisabled();
  test
    .expect(test.screen.getByRole('button', { name: 'NoteImprove', hidden: true }))
    .toBeDisabled();
  test.expect(test.screen.getByRole('button', { name: 'NoteUseVersion' })).toBeEnabled();
});

test.stable(
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
    mount(<NoteRuns id={id} />);
    test.expect(await test.screen.findByText('Retained generation title')).toBeVisible();
    const identity = test.screen.getByText('technical-request-identity');

    test.expect(identity.closest('details')).not.toHaveAttribute('open');
    test.expect(identity.closest('section')?.querySelector('time')).toBeNull();
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
  async () => {
    mount(<VersionedNote />);
    test.expect(test.screen.getByRole('button', { name: 'NoteNextVersion' })).toBeDisabled();
    test.expect(test.screen.getByText('NoteVersionLatest')).toBeVisible();
    test.fireEvent.click(test.screen.getByRole('button', { name: 'NotePreviousVersion' }));
    test.expect(test.screen.getByText('Historical note')).toBeVisible();
    test.expect(test.screen.getByText('1', { selector: '[role="status"]' })).toBeVisible();
    test.expect(test.screen.getByRole('button', { name: 'NotePreviousVersion' })).toBeDisabled();
    test.expect(test.screen.getByRole('button', { name: 'NoteUseVersion' })).toBeEnabled();
    test.fireEvent.click(test.screen.getByRole('button', { name: 'NoteNextVersion' }));
    test.expect(test.screen.getByText('Current note')).toBeVisible();
    test.expect(test.screen.getByText('NoteVersionLatest')).toBeVisible();
    test.expect(activateVersion).not.toHaveBeenCalled();
  }
);

test.stable(
  'keeps version browsing disabled while an edit or uncertain write owns the note and restores it after review',
  async () => {
    test.vi.mocked(editNote).mockRejectedValue(new StudyError('transient', 'Uncertain edit'));
    mount(<VersionedNote />);
    test.fireEvent.click(test.screen.getByRole('button', { name: 'NoteEditNote' }));
    await test.waitFor(() =>
      test
        .expect(test.screen.getByRole('button', { name: 'NotePreviousVersion', hidden: true }))
        .toBeDisabled()
    );
    test.fireEvent.click(test.screen.getByRole('button', { name: 'NoteCancel' }));
    await test.waitFor(() => test.expect(test.screen.queryByRole('dialog')).toBeNull());
    await test.waitFor(() =>
      test
        .expect(test.screen.getByRole('button', { name: 'NotePreviousVersion', hidden: true }))
        .toBeEnabled()
    );
    test.fireEvent.click(test.screen.getByRole('button', { name: 'NoteEditNote' }));
    test.fireEvent.click(await test.screen.findByRole('button', { name: 'NoteSaveNote' }));
    await test.screen.findByRole('alert');
    await test.waitFor(() =>
      test
        .expect(test.screen.getByRole('button', { name: 'NotePreviousVersion', hidden: true }))
        .toBeDisabled()
    );
    test.fireEvent.click(test.screen.getByRole('button', { name: 'LibraryRefresh' }));
    test.fireEvent.click(await test.screen.findByRole('button', { name: 'NoteReviewedHistory' }));
    await test.waitFor(() =>
      test
        .expect(test.screen.getByRole('button', { name: 'NotePreviousVersion', hidden: true }))
        .toBeEnabled()
    );
  }
);

test.stable('labels the newest saved version Latest even when another version is active', () => {
  mount(
    <VersionedNote
      value={{
        ...message,
        activeVersionId: message.versions[0]!.id,
        versions: [...message.versions].reverse()
      }}
    />
  );
  test.expect(test.screen.getByText('1', { selector: '[role="status"]' })).toBeVisible();
  test.fireEvent.click(test.screen.getByRole('button', { name: 'NoteNextVersion' }));
  test.expect(test.screen.getByText('NoteVersionLatest')).toBeVisible();
  test.expect(test.screen.getByRole('button', { name: 'NoteUseVersion' })).toBeEnabled();
  test.expect(activateVersion).not.toHaveBeenCalled();
});

test.stable('retains the same action controls while browsing saved versions', () => {
  mount(<VersionedNote />);
  const edit = test.screen.getByRole('button', { name: 'NoteEditNote' });
  const improve = test.screen.getByRole('button', { name: 'NoteImprove', hidden: true });
  const activate = test.screen.getByRole('button', { name: 'NoteUseVersion' });

  test.expect(activate).toBeDisabled();
  test.fireEvent.click(test.screen.getByRole('button', { name: 'NotePreviousVersion' }));
  test.expect(test.screen.getByRole('button', { name: 'NoteEditNote' })).toBe(edit);
  test.expect(test.screen.getByRole('button', { name: 'NoteImprove', hidden: true })).toBe(improve);
  test.expect(test.screen.getByRole('button', { name: 'NoteUseVersion' })).toBe(activate);
  test.expect(edit).toBeDisabled();
  test.expect(improve).toBeDisabled();
  test.expect(activate).toBeEnabled();
  test.fireEvent.click(test.screen.getByRole('button', { name: 'NoteNextVersion' }));
  test.expect(edit).toBeEnabled();
  test.expect(improve).toBeEnabled();
  test.expect(activate).toBeDisabled();
});

test.stable('protects an open edit from other toolbar actions', async () => {
  mount(<VersionedNote />);
  test.fireEvent.click(test.screen.getByRole('button', { name: 'NoteEditNote' }));
  await test.waitFor(() =>
    test
      .expect(test.screen.getByRole('button', { name: 'NoteImprove', hidden: true }))
      .toBeDisabled()
  );
  test
    .expect(test.screen.getByRole('button', { name: 'NoteCustomTransform', hidden: true }))
    .toBeDisabled();
  test.fireEvent.click(test.screen.getByRole('button', { name: 'NoteCancel' }));
  await test.waitFor(() =>
    test
      .expect(test.screen.getByRole('button', { name: 'NoteImprove', hidden: true }))
      .toBeEnabled()
  );
});

test.stable(
  'opens deliberate editing in a dialog while keeping the saved note in the notebook',
  async () => {
    mount(<VersionedNote />);
    test.fireEvent.click(test.screen.getByRole('button', { name: 'NoteEditNote' }));
    test.expect(await test.screen.findByRole('dialog', { name: 'NoteEditNote' })).toBeVisible();
    test.expect(test.screen.getByText('Current note', { selector: 'p' })).toBeInTheDocument();
    test.fireEvent.click(test.screen.getByRole('button', { name: 'NoteCancel' }));
    await test.waitFor(() =>
      test.expect(test.screen.queryByRole('dialog')).not.toBeInTheDocument()
    );
    test.expect(editNote).not.toHaveBeenCalled();
  }
);

test.stable('opens note actions on right click and edits the exact selected note', async () => {
  mount(<VersionedNote />);
  test.fireEvent.contextMenu(test.screen.getByText('Current note'), {
    button: 2,
    clientX: 80,
    clientY: 80
  });
  await test.userEvent
    .setup()
    .click(await test.screen.findByRole('menuitem', { name: 'NoteEditNote' }));
  test.expect(await test.screen.findByRole('dialog')).toBeVisible();
  test
    .expect(test.screen.getByRole('textbox', { name: 'NoteEditNote' }))
    .toHaveValue('Current note');
  test.expect(editNote).not.toHaveBeenCalled();
});

test.stable(
  'restricts historical note context actions to activating the selected version',
  async () => {
    mount(<VersionedNote />);
    test.fireEvent.click(test.screen.getByRole('button', { name: 'NotePreviousVersion' }));
    test.fireEvent.contextMenu(test.screen.getByText('Historical note'), {
      button: 2,
      clientX: 80,
      clientY: 80
    });
    test
      .expect(await test.screen.findByRole('menuitem', { name: 'NoteImprove' }))
      .toHaveAttribute('aria-disabled', 'true');
    test
      .expect(test.screen.getByRole('menuitem', { name: 'NoteEditNote' }))
      .toHaveAttribute('aria-disabled', 'true');
    await test.userEvent
      .setup()
      .click(test.screen.getByRole('menuitem', { name: 'NoteUseVersion' }));
    test.expect(await test.screen.findByRole('dialog')).toBeVisible();
    test.expect(test.screen.getByRole('dialog')).toHaveTextContent('Historical note');
    test.expect(activateVersion).not.toHaveBeenCalled();
  }
);

test.stable(
  'keeps pending assistant message context actions disabled and hides note editing',
  async () => {
    const pending = {
      ...message,
      role: 'assistant' as const,
      versions: message.versions.map((version) => ({ ...version, status: 'pending' as const }))
    };

    mount(<VersionedNote value={pending} />);
    test.fireEvent.contextMenu(test.screen.getByText('Current note'), {
      button: 2,
      clientX: 80,
      clientY: 80
    });
    test
      .expect(await test.screen.findByRole('menuitem', { name: 'NoteImprove' }))
      .toHaveAttribute('aria-disabled', 'true');
    test.expect(test.screen.queryByRole('menuitem', { name: 'NoteEditNote' })).toBeNull();
  }
);

test.stable('keeps raw note deletion in both the toolbar and right-click menu', async () => {
  mount(<VersionedNote />);
  test.expect(test.screen.getByRole('button', { name: 'NoteDeleteItem' })).toBeVisible();
  test.expect(test.screen.getByRole('button', { name: 'NoteDeleteVersion' })).toBeVisible();
  test.fireEvent.contextMenu(test.screen.getByText('Current note'), {
    button: 2,
    clientX: 80,
    clientY: 80
  });
  test.expect(await test.screen.findByRole('menuitem', { name: 'NoteDeleteItem' })).toBeVisible();
  await test.userEvent
    .setup()
    .click(test.screen.getByRole('menuitem', { name: 'NoteDeleteVersion' }));
  const dialog = await test.screen.findByRole('alertdialog');

  test.expect(test.within(dialog).getByText('NoteDeleteVersionHelp')).toBeVisible();
  await test.userEvent.setup().click(test.within(dialog).getByRole('button', { name: 'Cancel' }));
  await test.waitFor(() =>
    test.expect(test.screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  );
  test.expect(test.screen.getByRole('button', { name: 'NoteDeleteItem' })).toBeVisible();
});

test.stable('archives the exact note membership independently of permanent deletion', async () => {
  rpc.archive.mockResolvedValue(undefined);
  mount(<VersionedNote />);
  test.fireEvent.contextMenu(test.screen.getByText('Current note'), {
    button: 2,
    clientX: 80,
    clientY: 80
  });
  await test.userEvent
    .setup()
    .click(await test.screen.findByRole('menuitem', { name: 'NoteArchive' }));
  await test.waitFor(() =>
    test.expect(rpc.archive).toHaveBeenCalledExactlyOnceWith({
      noteId: id,
      target: { kind: 'message', id: message.id },
      archived: true
    })
  );
  test.expect(test.screen.queryByRole('alertdialog')).toBeNull();
});

test.stable('converts the selected active message version directly from its toolbar', async () => {
  rpc.convert.mockResolvedValue({
    requestId: 'converted',
    noteId: id,
    messageId: message.id,
    versionId: 99n
  });
  mount(actions());
  test.fireEvent.click(await test.screen.findByRole('button', { name: 'NoteConvertText' }));
  await test.waitFor(() =>
    test.expect(rpc.convert).toHaveBeenCalledWith({
      messageId: message.id,
      expectedActiveVersionId: message.activeVersionId,
      strategyId: 'chatgpt'
    })
  );
  test.expect(test.screen.queryByRole('dialog')).not.toBeInTheDocument();
});

test.stable('retries the original conversion payload after viewing another version', async () => {
  rpc.convert
    .mockRejectedValueOnce(new StudyError('transient', 'Unconfirmed'))
    .mockResolvedValueOnce({
      requestId: 'converted',
      noteId: id,
      messageId: message.id,
      versionId: 99n
    });
  const view = mount(actions());

  test.fireEvent.click(await test.screen.findByRole('button', { name: 'NoteConvertText' }));
  await test.screen.findByRole('button', { name: 'Retry' });
  view.rerender(
    <CanvasProvider registry={view.client}>{actions(message.versions[0].id)}</CanvasProvider>
  );
  test.fireEvent.click(await test.screen.findByRole('button', { name: 'Retry' }));
  await test.waitFor(() => test.expect(rpc.convert).toHaveBeenCalledTimes(2));
  test.expect(rpc.convert.mock.calls[1][0]).toEqual(rpc.convert.mock.calls[0][0]);
});

test.stable.each(['Copied text', ''])(
  'pasting files retains the clipboard text payload %j',
  async (text) => {
    const file = new File(['pdf'], 'pasted.pdf', { type: 'application/pdf' });

    test.vi
      .mocked(uploadSource)
      .mockResolvedValue({ id: 47n } as Awaited<ReturnType<typeof uploadSource>>);
    mount(<Composer id={id} />);
    const accepted = test.fireEvent.paste(test.screen.getByRole('textbox'), {
      clipboardData: {
        files: [file],
        getData: (kind: string) => (kind === 'text/plain' ? text : '')
      }
    });

    test.expect(accepted).toBe(!!text);
    await test.waitFor(() => test.expect(uploadSource).toHaveBeenCalledWith(file));
  }
);

test.stable('identifies the conversion icon on hover', async () => {
  const user = test.userEvent.setup();

  mount(<TooltipProvider delay={0}>{actions()}</TooltipProvider>);
  await user.hover(await test.screen.findByRole('button', { name: 'NoteConvertText' }));
  test.expect(await test.screen.findByRole('tooltip')).toHaveTextContent('NoteConvertText');
});
