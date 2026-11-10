import { StudyError } from '@study/contracts/errors';
import { chatMessageSchema } from '@study/contracts/notes/schemas';
import { testStable } from '@study/testing/vitest';
import { ChatMessageActionToolbar } from '@study/ui/chat';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type * as Router from '@tanstack/react-router';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Schema } from 'effect';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, expect, vi } from 'vite-plus/test';

import { useAiReadiness } from '#web/lib/ai-readiness.ts';
import { request } from '#web/lib/study-client/request.ts';

import { QuestionActions } from './question-actions';

vi.mock('#web/lib/ai-readiness.ts', () => ({ useAiReadiness: vi.fn(() => 'ready') }));

vi.mock('#web/lib/study-client/request.ts', () => ({ request: vi.fn() }));
vi.mock('@tanstack/react-router', async (load) => ({
  ...(await load<typeof Router>()),
  Link: ({ to, children }: { to: string; children?: ReactNode }) => <a href={to}>{children}</a>
}));

vi.mock('#web/lib/i18n.tsx', () => ({
  useI18n: () => ({ t: (key: string) => key, locale: 'english' })
}));
vi.mock('./pending-message-work', () => ({
  PendingMessageWork: () => <div role="status">NoteThinking</div>
}));

const caches: QueryClient[] = [];

const answer = vi.fn();

const mark = vi.fn();

const executions = vi.fn();

const restore = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useAiReadiness).mockReturnValue('ready');
  executions.mockResolvedValue({ items: [] });
  vi.mocked(request).mockImplementation(async (invoke) =>
    invoke({
      'notes.answerQuestion': answer,
      'notes.setMessageKind': mark,
      'workflows.executions': executions,
      'notes.setItemArchived': restore
    } as never)
  );
});
afterEach(() => {
  vi.useRealTimers();

  for (const cache of caches.splice(0)) cache.clear();
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
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
  });

  caches.push(cache);
  const view = render(
    <QueryClientProvider client={cache}>
      <QuestionActions message={message} versionId={versionId}>
        {(action) => (
          <ChatMessageActionToolbar aria-label="NoteItemActions">{action}</ChatMessageActionToolbar>
        )}
      </QuestionActions>
    </QueryClientProvider>
  );

  return {
    ...view,
    update: (next: typeof message) =>
      view.rerender(
        <QueryClientProvider client={cache}>
          <QuestionActions message={next} versionId={versionId}>
            {(action) => (
              <ChatMessageActionToolbar aria-label="NoteItemActions">
                {action}
              </ChatMessageActionToolbar>
            )}
          </QuestionActions>
        </QueryClientProvider>
      )
  };
}

testStable('puts Answer inside the message toolbar instead of a separate action row', () => {
  mount();
  const toolbar = within(screen.getByRole('group', { name: 'NoteItemActions' }));

  expect(toolbar.getByRole('button', { name: 'NoteAnswerQuestion' })).toBeVisible();
  expect(screen.queryByLabelText('NoteQuestionActions')).toBeNull();
});

testStable('answers the displayed question once while its request is pending', async () => {
  let resolve!: (value: unknown) => void;

  answer.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      })
  );
  mount();
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
});

testStable('lets users correct automatic question detection', async () => {
  mark.mockResolvedValueOnce(note('note'));
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'NoteMarkAsNote' }));
  await waitFor(() =>
    expect(mark).toHaveBeenCalledExactlyOnceWith({
      messageId: 2n,
      expectedActiveVersionId: 3n,
      kind: 'note'
    })
  );
});

testStable('lets users mark an ordinary note as a question', async () => {
  mark.mockResolvedValueOnce(note());
  mount(note('note'));
  expect(screen.queryByRole('button', { name: 'NoteAnswerQuestion' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'NoteMarkAsQuestion' }));
  await waitFor(() =>
    expect(mark).toHaveBeenCalledExactlyOnceWith({
      messageId: 2n,
      expectedActiveVersionId: 3n,
      kind: 'question'
    })
  );
});

testStable.each(['pending', 'complete'] as const)(
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
    expect(screen.queryByRole('button', { name: 'NoteViewAnswer' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'NoteAnswerQuestion' })).toBeNull();
    const mark = screen.getByRole('button', { name: 'NoteMarkAsNote' });

    if (status === 'pending') {
      expect(screen.getByRole('status')).toHaveTextContent('NoteThinking');
      expect(mark).toBeDisabled();
    } else expect(mark).toBeEnabled();
  }
);

testStable('disables question mutations while browsing historical content', () => {
  const message = note();

  mount(message, Schema.decodeUnknownSync(chatMessageSchema.fields.activeVersionId)(9n)!);
  expect(screen.getByRole('button', { name: 'NoteMarkAsQuestion' })).toBeDisabled();
  expect(screen.queryByRole('button', { name: 'NoteAnswerQuestion' })).toBeNull();
});

testStable('links to an existing answer instead of creating another', () => {
  const target = document.createElement('div');

  target.id = 'notebook-1-message-8';
  target.tabIndex = -1;
  target.scrollIntoView = vi.fn();
  document.body.append(target);
  mount(note('question', 8n));
  fireEvent.click(screen.getByRole('button', { name: 'NoteViewAnswer' }));
  expect(document.activeElement).toBe(target);
  expect(target.scrollIntoView).toHaveBeenCalledOnce();
  expect(answer).not.toHaveBeenCalled();
  target.remove();
});

testStable('offers a safe retry after an answer request fails', async () => {
  answer
    .mockRejectedValueOnce(new StudyError('transient', 'Unavailable'))
    .mockResolvedValueOnce({});
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'NoteAnswerQuestion' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Retry' }));
  await waitFor(() => expect(answer).toHaveBeenCalledTimes(2));
  expect(answer).toHaveBeenLastCalledWith({ messageId: 2n, expectedActiveVersionId: 3n });
});

testStable('does not classify assistant messages or document pages', () => {
  const message = note();
  const view = mount({ ...message, role: 'assistant' });

  expect(screen.queryByRole('button')).toBeNull();
  view.unmount();
  mount({ ...message, format: 'document' });
  expect(screen.queryByRole('button')).toBeNull();
});

testStable.each(['failed', 'cancelled'])(
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
    fireEvent.click(await screen.findByRole('button', { name: 'NoteRetryAnswer' }));
    await waitFor(() =>
      expect(answer).toHaveBeenCalledExactlyOnceWith({
        messageId: 2n,
        expectedActiveVersionId: 3n
      })
    );
  }
);

testStable('restores an archived answer through its note membership', async () => {
  restore.mockResolvedValueOnce(undefined);
  mount(note('question', 8n, 'request-1', true));
  fireEvent.click(screen.getByRole('button', { name: 'NoteRestoreAnswer' }));
  await waitFor(() =>
    expect(restore).toHaveBeenCalledExactlyOnceWith({
      noteId: 1n,
      target: { kind: 'message', id: 8n },
      archived: false
    })
  );
  expect(answer).not.toHaveBeenCalled();
});

testStable('uses the authoritative receipt after a linked answer is deleted', async () => {
  answer.mockResolvedValueOnce({ messageId: 8n, requestId: 'old-request' });
  const view = mount();

  fireEvent.click(screen.getByRole('button', { name: 'NoteAnswerQuestion' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'NoteMarkAsNote' })).toBeEnabled());
  view.update(note());
  expect(screen.getByRole('button', { name: 'NoteAnswerQuestion' })).toBeEnabled();
  expect(screen.queryByRole('button', { name: 'NoteViewAnswer' })).toBeNull();
});

testStable.each(['completed', 'cancelled', 'running'])(
  'polls only while the answer is active: %s',
  async (status) => {
    vi.useFakeTimers();
    executions.mockResolvedValue({
      items: [{ id: 'execution', status, outcome: status === 'completed' ? 'success' : null }]
    });
    mount(note('question', 8n, 'request-1'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
    expect(executions).toHaveBeenCalledOnce();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(9000);
    });

    if (status === 'running') expect(executions.mock.calls.length).toBeGreaterThan(1);
    else expect(executions).toHaveBeenCalledOnce();
  }
);

testStable(
  'blocks marking a note as a question without a provider but permits marking it back',
  () => {
    vi.mocked(useAiReadiness).mockReturnValue('setup');
    const view = mount(note('note'));
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

testStable(
  'removes an AI retry after provider setup is removed and restores it afterward',
  async () => {
    answer.mockRejectedValueOnce(new StudyError('transient', 'Unavailable'));
    const message = note();
    const view = mount(message);

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
