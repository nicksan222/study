import { chatMessageSchema } from '@study/contracts/conversations/schemas';
import { StudyError } from '@study/contracts/errors';
import { testStable } from '@study/testing/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Schema } from 'effect';
import { afterEach, beforeEach, expect, vi } from 'vite-plus/test';

import { request } from '#web/lib/study-client/request.ts';

import { QuestionActions } from './question-actions';

vi.mock('#web/lib/study-client/request.ts', () => ({ request: vi.fn() }));
vi.mock('#web/lib/i18n.tsx', () => ({
  useI18n: () => ({ t: (key: string) => key, locale: 'english' })
}));

const caches: QueryClient[] = [];

const answer = vi.fn();

const mark = vi.fn();

const executions = vi.fn();

const restore = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  executions.mockResolvedValue({ items: [] });
  vi.mocked(request).mockImplementation(async (invoke) =>
    invoke({
      'conversations.answerQuestion': answer,
      'conversations.setMessageKind': mark,
      'workflows.executions': executions,
      'conversations.setItemArchived': restore
    } as never)
  );
});
afterEach(() => {
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
    sessionId: 1n,
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
      <QuestionActions message={message} versionId={versionId} />
    </QueryClientProvider>
  );

  return {
    ...view,
    update: (next: typeof message) =>
      view.rerender(
        <QueryClientProvider client={cache}>
          <QuestionActions message={next} versionId={versionId} />
        </QueryClientProvider>
      )
  };
}

testStable('answers the displayed question once while its request is pending', async () => {
  let resolve!: (value: unknown) => void;

  answer.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      })
  );
  mount();
  const button = screen.getByRole('button', { name: 'SessionAnswerQuestion' });

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
  fireEvent.click(screen.getByRole('button', { name: 'SessionMarkAsNote' }));
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
  expect(screen.queryByRole('button', { name: 'SessionAnswerQuestion' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'SessionMarkAsQuestion' }));
  await waitFor(() =>
    expect(mark).toHaveBeenCalledExactlyOnceWith({
      messageId: 2n,
      expectedActiveVersionId: 3n,
      kind: 'question'
    })
  );
});

testStable('disables question mutations while browsing historical content', () => {
  const message = note();

  mount(message, Schema.decodeUnknownSync(chatMessageSchema.fields.activeVersionId)(9n)!);
  expect(screen.getByRole('button', { name: 'SessionMarkAsQuestion' })).toBeDisabled();
  expect(screen.queryByRole('button', { name: 'SessionAnswerQuestion' })).toBeNull();
});

testStable('links to an existing answer instead of creating another', () => {
  const target = document.createElement('div');

  target.id = 'notebook-1-message-8';
  target.tabIndex = -1;
  target.scrollIntoView = vi.fn();
  document.body.append(target);
  mount(note('question', 8n));
  fireEvent.click(screen.getByRole('button', { name: 'SessionViewAnswer' }));
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
  fireEvent.click(screen.getByRole('button', { name: 'SessionAnswerQuestion' }));
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
    fireEvent.click(await screen.findByRole('button', { name: 'SessionRetryAnswer' }));
    await waitFor(() =>
      expect(answer).toHaveBeenCalledExactlyOnceWith({
        messageId: 2n,
        expectedActiveVersionId: 3n
      })
    );
  }
);

testStable('restores an archived answer through its session membership', async () => {
  restore.mockResolvedValueOnce(undefined);
  mount(note('question', 8n, 'request-1', true));
  fireEvent.click(screen.getByRole('button', { name: 'SessionRestoreAnswer' }));
  await waitFor(() =>
    expect(restore).toHaveBeenCalledExactlyOnceWith({
      sessionId: 1n,
      target: { kind: 'message', id: 8n },
      archived: false
    })
  );
  expect(answer).not.toHaveBeenCalled();
});

testStable('uses the authoritative receipt after a linked answer is deleted', async () => {
  answer.mockResolvedValueOnce({ messageId: 8n, requestId: 'old-request' });
  const view = mount();

  fireEvent.click(screen.getByRole('button', { name: 'SessionAnswerQuestion' }));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'SessionMarkAsNote' })).toBeEnabled()
  );
  view.update(note());
  expect(screen.getByRole('button', { name: 'SessionAnswerQuestion' })).toBeEnabled();
  expect(screen.queryByRole('button', { name: 'SessionViewAnswer' })).toBeNull();
});
