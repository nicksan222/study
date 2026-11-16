import { StudyError, chatMessageSchema } from '@study/contracts';
import { test } from '@study/testing';
import { ChatMessageActionToolbar } from '@study/ui';
import type * as Router from '@tanstack/react-router';
import { Schema } from 'effect';
import type { ReactNode } from 'react';

import { useAiReadiness } from '#client/lib/ai-readiness.ts';

import { QuestionActions } from './question-actions';

test.mock('#client/lib/ai-readiness.ts', () => ({ useAiReadiness: test.vi.fn(() => 'ready') }));

test.mock('@tanstack/react-router', async (load) => ({
  ...(await load<typeof Router>()),
  Link: ({ to, children }: { to: string; children?: ReactNode }) => <a href={to}>{children}</a>
}));

test.mock('#client/lib/i18n.tsx', () => ({
  useI18n: () => ({ t: (key: string) => key, locale: 'english' })
}));
test.mock('./pending-message-work', () => ({
  PendingMessageWork: () => <div role="status">NoteThinking</div>
}));

const answer = test.vi.fn();

const mark = test.vi.fn();

const executions = test.vi.fn();

const restore = test.vi.fn();

test.beforeEach(() => {
  test.vi.clearAllMocks();
  test.vi.mocked(useAiReadiness).mockReturnValue('ready');
  executions.mockResolvedValue({ items: [] });
});
test.afterEach(() => {
  test.vi.useRealTimers();
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

function mount(message = note(), versionId = message.activeVersionId!) {
  const fixture = test.rpcTestTransport(async (tag, input) => {
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
  const view = test.render(
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

test.stable('puts Answer inside the message toolbar instead of a separate action row', () => {
  mount();
  const toolbar = test.within(test.screen.getByRole('group', { name: 'NoteItemActions' }));

  test.expect(toolbar.getByRole('button', { name: 'NoteAnswerQuestion' })).toBeVisible();
  test.expect(test.screen.queryByLabelText('NoteQuestionActions')).toBeNull();
});

test.stable('answers the displayed question once while its request is pending', async () => {
  let resolve!: (value: unknown) => void;

  answer.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      })
  );
  mount();
  const button = test.screen.getByRole('button', { name: 'NoteAnswerQuestion' });

  test.fireEvent.click(button);
  await test.waitFor(() => test.expect(button).toBeDisabled());
  test.fireEvent.click(button);
  test.expect(answer).toHaveBeenCalledExactlyOnceWith({
    messageId: 2n,
    expectedActiveVersionId: 3n
  });
  resolve({});
  await test.waitFor(() => test.expect(button).toBeEnabled());
});

test.stable('lets users correct automatic question detection', async () => {
  mark.mockResolvedValueOnce(note('note'));
  mount();
  test.fireEvent.click(test.screen.getByRole('button', { name: 'NoteMarkAsNote' }));
  await test.waitFor(() =>
    test.expect(mark).toHaveBeenCalledExactlyOnceWith({
      messageId: 2n,
      expectedActiveVersionId: 3n,
      kind: 'note'
    })
  );
});

test.stable('lets users mark an ordinary note as a question', async () => {
  mark.mockResolvedValueOnce(note());
  mount(note('note'));
  test.expect(test.screen.queryByRole('button', { name: 'NoteAnswerQuestion' })).toBeNull();
  test.fireEvent.click(test.screen.getByRole('button', { name: 'NoteMarkAsQuestion' }));
  await test.waitFor(() =>
    test.expect(mark).toHaveBeenCalledExactlyOnceWith({
      messageId: 2n,
      expectedActiveVersionId: 3n,
      kind: 'question'
    })
  );
});

test.stable.each(['pending', 'complete'] as const)(
  'keeps an in-place %s answer in the original entry without a separate answer link',
  (status) => {
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

    mount({
      ...message,
      activeVersionId: status === 'complete' ? answerVersion.id : message.activeVersionId,
      versions: [...message.versions, answerVersion],
      question: { ...message.question!, answerVersionId: answerVersion.id }
    });
    test.expect(test.screen.queryByRole('button', { name: 'NoteViewAnswer' })).toBeNull();
    test.expect(test.screen.queryByRole('button', { name: 'NoteAnswerQuestion' })).toBeNull();
    const mark = test.screen.getByRole('button', { name: 'NoteMarkAsNote' });

    if (status === 'pending') {
      test.expect(test.screen.getByRole('status')).toHaveTextContent('NoteThinking');
      test.expect(mark).toBeDisabled();
    } else test.expect(mark).toBeEnabled();
  }
);

test.stable('disables question mutations while browsing historical content', () => {
  const message = note();

  mount(message, Schema.decodeUnknownSync(chatMessageSchema.fields.activeVersionId)(9n)!);
  test.expect(test.screen.getByRole('button', { name: 'NoteMarkAsQuestion' })).toBeDisabled();
  test.expect(test.screen.queryByRole('button', { name: 'NoteAnswerQuestion' })).toBeNull();
});

test.stable('links to an existing answer instead of creating another', () => {
  const target = document.createElement('div');

  target.id = 'notebook-1-message-8';
  target.tabIndex = -1;
  target.scrollIntoView = test.vi.fn();
  document.body.append(target);
  mount(note('question', 8n));
  test.fireEvent.click(test.screen.getByRole('button', { name: 'NoteViewAnswer' }));
  test.expect(document.activeElement).toBe(target);
  test.expect(target.scrollIntoView).toHaveBeenCalledOnce();
  test.expect(answer).not.toHaveBeenCalled();
  target.remove();
});

test.stable('offers a safe retry after an answer request fails', async () => {
  answer
    .mockRejectedValueOnce(new StudyError('transient', 'Unavailable'))
    .mockResolvedValueOnce({});
  mount();
  test.fireEvent.click(test.screen.getByRole('button', { name: 'NoteAnswerQuestion' }));
  test.fireEvent.click(await test.screen.findByRole('button', { name: 'Retry' }));
  await test.waitFor(() => test.expect(answer).toHaveBeenCalledTimes(2));
  test.expect(answer).toHaveBeenLastCalledWith({ messageId: 2n, expectedActiveVersionId: 3n });
});

test.stable('does not classify assistant messages or document pages', () => {
  const message = note();
  const view = mount({ ...message, role: 'assistant' });

  test.expect(test.screen.queryByRole('button')).toBeNull();
  view.unmount();
  mount({ ...message, format: 'document' });
  test.expect(test.screen.queryByRole('button')).toBeNull();
});

test.stable.each(['failed', 'cancelled'])(
  'retries a terminal %s answer through the same question target',
  async (state) => {
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
    mount(note('question', 8n, 'request-1'));
    test.fireEvent.click(await test.screen.findByRole('button', { name: 'NoteRetryAnswer' }));
    await test.waitFor(() =>
      test.expect(answer).toHaveBeenCalledExactlyOnceWith({
        messageId: 2n,
        expectedActiveVersionId: 3n
      })
    );
  }
);

test.stable('restores an archived answer through its note membership', async () => {
  restore.mockResolvedValueOnce(undefined);
  mount(note('question', 8n, 'request-1', true));
  test.fireEvent.click(test.screen.getByRole('button', { name: 'NoteRestoreAnswer' }));
  await test.waitFor(() =>
    test.expect(restore).toHaveBeenCalledExactlyOnceWith({
      noteId: 1n,
      target: { kind: 'message', id: 8n },
      archived: false
    })
  );
  test.expect(answer).not.toHaveBeenCalled();
});

test.stable('uses the authoritative receipt after a linked answer is deleted', async () => {
  answer.mockResolvedValueOnce({ messageId: 8n, requestId: 'old-request' });
  const view = mount();

  test.fireEvent.click(test.screen.getByRole('button', { name: 'NoteAnswerQuestion' }));
  await test.waitFor(() =>
    test.expect(test.screen.getByRole('button', { name: 'NoteMarkAsNote' })).toBeEnabled()
  );
  view.update(note());
  test.expect(test.screen.getByRole('button', { name: 'NoteAnswerQuestion' })).toBeEnabled();
  test.expect(test.screen.queryByRole('button', { name: 'NoteViewAnswer' })).toBeNull();
});

test.stable.each(['completed', 'cancelled', 'running'])(
  'observes authoritative answer updates without a component polling timer: %s',
  async (status) => {
    executions.mockResolvedValue({
      items: [{ id: 'execution', status, outcome: status === 'completed' ? 'success' : null }]
    });
    const view = mount(note('question', 8n, 'request-1'));

    await test.waitFor(() => test.expect(executions).toHaveBeenCalledOnce());
    await test.act(async () => {
      await view.notify();
    });
    test.expect(executions).toHaveBeenCalledTimes(2);
  }
);

test.stable(
  'blocks marking a note as a question without a provider but permits marking it back',
  () => {
    test.vi.mocked(useAiReadiness).mockReturnValue('setup');
    const view = mount(note('note'));
    const question = test.screen.getByRole('button', { name: 'NoteMarkAsQuestion' });

    test.expect(question).toBeDisabled();
    test.fireEvent.click(question);
    test.expect(mark).not.toHaveBeenCalled();
    view.update(note('question'));
    const plain = test.screen.getByRole('button', { name: 'NoteMarkAsNote' });

    test.expect(plain).toBeEnabled();
    test.fireEvent.click(plain);
  }
);

test.stable(
  'removes an AI retry after provider setup is removed and restores it afterward',
  async () => {
    answer.mockRejectedValueOnce(new StudyError('transient', 'Unavailable'));
    const message = note();
    const view = mount(message);

    test.fireEvent.click(test.screen.getByRole('button', { name: 'NoteAnswerQuestion' }));
    await test.screen.findByRole('button', { name: 'Retry' });
    test.vi.mocked(useAiReadiness).mockReturnValue('setup');
    view.update(message);
    test.expect(test.screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    test.expect(answer).toHaveBeenCalledTimes(1);
    test.vi.mocked(useAiReadiness).mockReturnValue('ready');
    view.update(message);
    test.expect(test.screen.getByRole('button', { name: 'Retry' })).toBeEnabled();
  }
);
