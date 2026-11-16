import { StudyError, chatMessageSchema } from '@study/contracts';
import { test } from '@study/testing';
import { ChatMessageActionToolbar } from '@study/ui';
import type * as Router from '@tanstack/react-router';
import { Schema } from 'effect';
import type { ReactNode } from 'react';

import type * as __MockType0 from '#client/lib/ai-readiness.ts';

import type * as __MockType1 from './question-actions';

let useAiReadiness: typeof __MockType0.useAiReadiness;

let QuestionActions: typeof __MockType1.QuestionActions;

let answer: ReturnType<typeof createMockState>['answer'];

let mark: ReturnType<typeof createMockState>['mark'];

let executions: ReturnType<typeof createMockState>['executions'];

let restore: ReturnType<typeof createMockState>['restore'];

function createMockState(mock: test.Mock) {
  return {
    answer: mock.fn(),
    mark: mock.fn(),
    executions: mock.fn(),
    restore: mock.fn()
  };
}

test.beforeEach(async ({ mock }) => {
  const __mockState = createMockState(mock);

  answer = __mockState.answer;
  mark = __mockState.mark;
  executions = __mockState.executions;
  restore = __mockState.restore;

  mock('#client/lib/ai-readiness.ts', () => ({ useAiReadiness: mock.fn(() => 'ready') }));
  mock('@tanstack/react-router', async (load) => ({
    ...(await load<typeof Router>()),
    Link: ({ to, children }: { to: string; children?: ReactNode }) => <a href={to}>{children}</a>
  }));
  mock('#client/lib/i18n.tsx', () => ({
    useI18n: () => ({ t: (key: string) => key, locale: 'english' })
  }));
  mock('#client/features/note-workspace/pending-message-work', () => ({
    PendingMessageWork: () => <div role="status">NoteThinking</div>
  }));
  const __mockModule0 = await import('#client/lib/ai-readiness.ts');

  useAiReadiness = __mockModule0.useAiReadiness;
  const __mockModule1 = await import('./question-actions');

  QuestionActions = __mockModule1.QuestionActions;
});

test.beforeEach(({ vi }) => {
  vi.clearAllMocks();
  vi.mocked(useAiReadiness).mockReturnValue('ready');
  executions.mockResolvedValue({ items: [] });
});
test.afterEach(({ vi }) => {
  vi.useRealTimers();
});

function note(
  kind: 'question' | 'note' = 'question',
  answerMessageId?: bigint,
  answerRequestId?: string,
  answerArchived = false
) {
  return Schema.decodeUnknownSync(chatMessageSchema)({
    id: 2n,
    noteId: 1n,
    role: 'user',
    threadRoot: null,
    replyTo: null,
    activeVersionId: 3n,
    recordingId: null,
    recordingMs: null,
    recordedIn: null,
    createdAt: 1n,
    versions: [
      {
        id: 3n,
        number: 1n,
        origin: 'typed',
        instruction: null,
        status: 'complete',
        text: 'Why does this happen?',
        basedOn: null,
        createdAt: 1n
      }
    ],
    parts: [],
    citations: [],
    question: {
      kind,
      origin: 'automatic',
      versionId: 3n,
      answerMessageId,
      answerRequestId,
      answerArchived
    }
  });
}

function mount(
  { rpcTestTransport, render }: Pick<test.Context, 'rpcTestTransport' | 'render'>,
  message = note(),
  versionId = message.activeVersionId!
) {
  const fixture = rpcTestTransport(async (tag, input) => {
    if (tag === 'notes.answerQuestion')
      return {
        requestId: 'answer',
        noteId: 1n,
        messageId: 2n,
        versionId: 3n,
        ...(await answer(input))
      };

    if (tag === 'notes.setMessageKind') return mark(input);

    if (tag === 'notes.setItemArchived') return restore(input);

    if (tag === 'workflows.executions') {
      const page = await executions(input);

      return {
        next: null,
        ...page,
        items: page.items.map((item: object) => ({
          workflow: 'reply',
          correlationId: 'request-1',
          failureKind: null,
          configurationWaitReason: null,
          canCancel: false,
          createdAtMs: 1n,
          updatedAtMs: 1n,
          ...item
        }))
      };
    }

    throw new StudyError('unsupported', tag);
  });
  const Provider = fixture.wrapper;
  const view = render(
    <Provider>
      <QuestionActions message={message} versionId={versionId}>
        {(action) => (
          <ChatMessageActionToolbar aria-label="NoteItemActions">{action}</ChatMessageActionToolbar>
        )}
      </QuestionActions>
    </Provider>
  );

  return {
    ...view,
    notify: fixture.notify,
    update: (next: typeof message) =>
      view.rerender(
        <Provider>
          <QuestionActions message={next} versionId={versionId}>
            {(action) => (
              <ChatMessageActionToolbar aria-label="NoteItemActions">
                {action}
              </ChatMessageActionToolbar>
            )}
          </QuestionActions>
        </Provider>
      )
  };
}

test.stable(
  'puts Answer inside the message toolbar instead of a separate action row',
  ({ within, screen, expect, rpcTestTransport, render }) => {
    mount({ rpcTestTransport, render });
    const toolbar = within(screen.getByRole('group', { name: 'NoteItemActions' }));

    expect(toolbar.getByRole('button', { name: 'NoteAnswerQuestion' })).toBeVisible();
    expect(screen.queryByLabelText('NoteQuestionActions')).toBeNull();
  }
);

test.stable(
  'answers the displayed question once while its request is pending',
  async ({ screen, fireEvent, waitFor, expect, rpcTestTransport, render }) => {
    let resolve!: (value: unknown) => void;

    answer.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        })
    );
    mount({ rpcTestTransport, render });
    const button = screen.getByRole('button', { name: 'NoteAnswerQuestion' });

    fireEvent.click(button);
    await waitFor(() => expect(button).toBeDisabled());
    fireEvent.click(button);
    expect(answer).toHaveBeenCalledExactlyOnceWith({
      messageId: 2n,
      expectedActiveVersionId: 3n
    });
    resolve({});
    await waitFor(() => expect(button).toBeEnabled());
  }
);

test.stable(
  'lets users correct automatic question detection',
  async ({ fireEvent, screen, waitFor, expect, rpcTestTransport, render }) => {
    mark.mockResolvedValueOnce(note('note'));
    mount({ rpcTestTransport, render });
    fireEvent.click(screen.getByRole('button', { name: 'NoteMarkAsNote' }));
    await waitFor(() =>
      expect(mark).toHaveBeenCalledExactlyOnceWith({
        messageId: 2n,
        expectedActiveVersionId: 3n,
        kind: 'note'
      })
    );
  }
);

test.stable(
  'lets users mark an ordinary note as a question',
  async ({ expect, screen, fireEvent, waitFor, rpcTestTransport, render }) => {
    mark.mockResolvedValueOnce(note());
    mount({ rpcTestTransport, render }, note('note'));
    expect(screen.queryByRole('button', { name: 'NoteAnswerQuestion' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'NoteMarkAsQuestion' }));
    await waitFor(() =>
      expect(mark).toHaveBeenCalledExactlyOnceWith({
        messageId: 2n,
        expectedActiveVersionId: 3n,
        kind: 'question'
      })
    );
  }
);

test.stable.for(['pending', 'complete'] as const)(
  'keeps an in-place %s answer in the original entry without a separate answer link',
  (status, { expect, screen, rpcTestTransport, render }) => {
    const message = note('question', 2n, 'answer-in-place');
    const answerVersion = {
      ...message.versions[0]!,
      id: Schema.decodeUnknownSync(chatMessageSchema.fields.activeVersionId)(4n)!,
      number: 2n,
      origin: 'answer' as const,
      status,
      text: status === 'complete' ? '**Question**\n\nWhy?\n\n**Answer**\n\nBecause.' : '',
      basedOn: message.activeVersionId
    };

    mount(
      { rpcTestTransport, render },
      {
        ...message,
        activeVersionId: status === 'complete' ? answerVersion.id : message.activeVersionId,
        versions: [...message.versions, answerVersion],
        question: { ...message.question!, answerVersionId: answerVersion.id }
      }
    );
    expect(screen.queryByRole('button', { name: 'NoteViewAnswer' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'NoteAnswerQuestion' })).toBeNull();
    const mark = screen.getByRole('button', { name: 'NoteMarkAsNote' });

    if (status === 'pending') {
      expect(screen.getByRole('status')).toHaveTextContent('NoteThinking');
      expect(mark).toBeDisabled();
    } else expect(mark).toBeEnabled();
  }
);

test.stable(
  'disables question mutations while browsing historical content',
  ({ expect, screen, rpcTestTransport, render }) => {
    const message = note();

    mount(
      { rpcTestTransport, render },
      message,
      Schema.decodeUnknownSync(chatMessageSchema.fields.activeVersionId)(9n)!
    );
    expect(screen.getByRole('button', { name: 'NoteMarkAsQuestion' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'NoteAnswerQuestion' })).toBeNull();
  }
);

test.stable(
  'links to an existing answer instead of creating another',
  ({ vi, fireEvent, screen, expect, rpcTestTransport, render }) => {
    const target = document.createElement('div');

    target.id = 'notebook-1-message-8';
    target.tabIndex = -1;
    target.scrollIntoView = vi.fn();
    document.body.append(target);
    mount({ rpcTestTransport, render }, note('question', 8n));
    fireEvent.click(screen.getByRole('button', { name: 'NoteViewAnswer' }));
    expect(document.activeElement).toBe(target);
    expect(target.scrollIntoView).toHaveBeenCalledOnce();
    expect(answer).not.toHaveBeenCalled();
    target.remove();
  }
);

test.stable(
  'offers a safe retry after an answer request fails',
  async ({ fireEvent, screen, waitFor, expect, rpcTestTransport, render }) => {
    answer
      .mockRejectedValueOnce(new StudyError('transient', 'Unavailable'))
      .mockResolvedValueOnce({});
    mount({ rpcTestTransport, render });
    fireEvent.click(screen.getByRole('button', { name: 'NoteAnswerQuestion' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(answer).toHaveBeenCalledTimes(2));
    expect(answer).toHaveBeenLastCalledWith({ messageId: 2n, expectedActiveVersionId: 3n });
  }
);

test.stable(
  'does not classify assistant messages or document pages',
  ({ expect, screen, rpcTestTransport, render }) => {
    const message = note();
    const view = mount({ rpcTestTransport, render }, { ...message, role: 'assistant' });

    expect(screen.queryByRole('button')).toBeNull();
    view.unmount();
    mount({ rpcTestTransport, render }, { ...message, format: 'document' });
    expect(screen.queryByRole('button')).toBeNull();
  }
);

test.stable.for(['failed', 'cancelled'])(
  'retries a terminal %s answer through the same question target',
  async (state, { fireEvent, screen, waitFor, expect, rpcTestTransport, render }) => {
    executions.mockResolvedValue({
      items: [
        {
          id: 'execution',
          outcome: state === 'failed' ? 'failure' : null,
          status: state === 'failed' ? 'completed' : 'cancelled'
        }
      ]
    });
    answer.mockResolvedValueOnce({});
    mount({ rpcTestTransport, render }, note('question', 8n, 'request-1'));
    fireEvent.click(await screen.findByRole('button', { name: 'NoteRetryAnswer' }));
    await waitFor(() =>
      expect(answer).toHaveBeenCalledExactlyOnceWith({
        messageId: 2n,
        expectedActiveVersionId: 3n
      })
    );
  }
);

test.stable(
  'restores an archived answer through its note membership',
  async ({ fireEvent, screen, waitFor, expect, rpcTestTransport, render }) => {
    restore.mockResolvedValueOnce(undefined);
    mount({ rpcTestTransport, render }, note('question', 8n, 'request-1', true));
    fireEvent.click(screen.getByRole('button', { name: 'NoteRestoreAnswer' }));
    await waitFor(() =>
      expect(restore).toHaveBeenCalledExactlyOnceWith({
        noteId: 1n,
        target: { kind: 'message', id: 8n },
        archived: false
      })
    );
    expect(answer).not.toHaveBeenCalled();
  }
);

test.stable(
  'uses the authoritative receipt after a linked answer is deleted',
  async ({ fireEvent, screen, waitFor, expect, rpcTestTransport, render }) => {
    answer.mockResolvedValueOnce({ messageId: 8n, requestId: 'old-request' });
    const view = mount({ rpcTestTransport, render });

    fireEvent.click(screen.getByRole('button', { name: 'NoteAnswerQuestion' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'NoteMarkAsNote' })).toBeEnabled()
    );
    view.update(note());
    expect(screen.getByRole('button', { name: 'NoteAnswerQuestion' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'NoteViewAnswer' })).toBeNull();
  }
);

test.stable.for(['completed', 'cancelled', 'running'])(
  'observes authoritative answer updates without a component polling timer: %s',
  async (status, { waitFor, expect, act, rpcTestTransport, render }) => {
    executions.mockResolvedValue({
      items: [{ id: 'execution', status, outcome: status === 'completed' ? 'success' : null }]
    });
    const view = mount({ rpcTestTransport, render }, note('question', 8n, 'request-1'));

    await waitFor(() => expect(executions).toHaveBeenCalledOnce());
    await act(async () => {
      await view.notify();
    });
    expect(executions).toHaveBeenCalledTimes(2);
  }
);

test.stable(
  'blocks marking a note as a question without a provider but permits marking it back',
  ({ vi, screen, expect, fireEvent, rpcTestTransport, render }) => {
    vi.mocked(useAiReadiness).mockReturnValue('setup');
    const view = mount({ rpcTestTransport, render }, note('note'));
    const question = screen.getByRole('button', { name: 'NoteMarkAsQuestion' });

    expect(question).toBeDisabled();
    fireEvent.click(question);
    expect(mark).not.toHaveBeenCalled();
    view.update(note('question'));
    const plain = screen.getByRole('button', { name: 'NoteMarkAsNote' });

    expect(plain).toBeEnabled();
    fireEvent.click(plain);
  }
);

test.stable(
  'removes an AI retry after provider setup is removed and restores it afterward',
  async ({ fireEvent, screen, vi, expect, rpcTestTransport, render }) => {
    answer.mockRejectedValueOnce(new StudyError('transient', 'Unavailable'));
    const message = note();
    const view = mount({ rpcTestTransport, render }, message);

    fireEvent.click(screen.getByRole('button', { name: 'NoteAnswerQuestion' }));
    await screen.findByRole('button', { name: 'Retry' });
    vi.mocked(useAiReadiness).mockReturnValue('setup');
    view.update(message);
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(answer).toHaveBeenCalledTimes(1);
    vi.mocked(useAiReadiness).mockReturnValue('ready');
    view.update(message);
    expect(screen.getByRole('button', { name: 'Retry' })).toBeEnabled();
  }
);
