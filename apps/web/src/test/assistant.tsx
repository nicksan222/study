import { StudyError } from '@study/contracts/errors';
import type { ChatMessage } from '@study/contracts/notes/messages';
import type { assistantAskInputSchema } from '@study/contracts/notes/rpc';
import { chatMessageSchema, askResultSchema, noteSchema } from '@study/contracts/notes/schemas';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { Effect, Schema } from 'effect';
import { afterEach, beforeEach, vi } from 'vite-plus/test';

import { AssistantProvider } from '#web/features/assistant/note.tsx';
import type { StudyClient } from '#web/lib/study-client/client.ts';
import { Page } from '#web/pages/assistant/page.tsx';

const api = vi.hoisted(() => ({
  note: vi.fn(),
  chats: vi.fn(),
  context: vi.fn(),
  newChat: vi.fn(),
  thread: vi.fn(),
  ask: vi.fn<
    (input: typeof assistantAskInputSchema.Type) => Promise<typeof askResultSchema.Type>
  >(),
  provenance: vi.fn(),
  progress: vi.fn(),
  executions: vi.fn(),
  subscribe: vi.fn(),
  reanswer: vi.fn(),
  cancel: vi.fn()
}));

vi.mock('#web/lib/study-client/request.ts', () => ({
  request: (invoke: (rpc: object) => Effect.Effect<unknown, unknown>) => {
    const rpc = {
      'notes.assistantNote': api.note,
      'notes.assistantChats': api.chats,
      'notes.assistantContext': api.context,
      'notes.newAssistantNote': api.newChat,
      'notes.thread': api.thread,
      'notes.assistantAsk': api.ask,
      'notes.replyVersion': api.provenance,
      'workflows.agentProgress': api.progress,
      'notes.reanswer': api.reanswer,
      'workflows.executions': api.executions,
      'workflows.cancelExecution': api.cancel,
      'projects.projects': async () => ({ items: [], next: null }),
      'notes.notes': async () => ({ items: [], next: null })
    } satisfies Partial<Record<keyof StudyClient, unknown>>;

    return Effect.runPromise(
      invoke(
        new Proxy(rpc, {
          get:
            (target, key) =>
            (...args: unknown[]) =>
              Effect.tryPromise(() => {
                const method = Reflect.get(target, key);

                return method
                  ? method(...args)
                  : Promise.reject(new StudyError('unsupported', 'Unused test request'));
              })
        })
      )
    );
  }
}));
vi.mock('#web/lib/study-client/subscriptions.ts', () => ({ subscribe: api.subscribe }));

export function message(
  role: 'user' | 'assistant',
  text: string,
  id: bigint,
  pending = false
): ChatMessage {
  return Schema.decodeUnknownSync(chatMessageSchema)({
    id,
    noteId: 91n,
    role,
    threadRoot: null,
    replyTo: role === 'assistant' ? id - 1n : null,
    activeVersionId: id,
    recordingId: null,
    recordingMs: null,
    recordedIn: null,
    createdAt: id,
    versions: [
      {
        id,
        number: 1n,
        origin: role === 'assistant' ? 'answer' : 'typed',
        status: pending ? 'pending' : 'complete',
        text,
        basedOn: null,
        instruction: null,
        createdAt: id
      }
    ],
    parts: [],
    citations: []
  });
}

const clients: QueryClient[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  let messages: ChatMessage[] = [];

  api.note.mockImplementation(async (input) =>
    Schema.decodeUnknownSync(noteSchema)({
      id: input.id ?? 91n,
      projectIds: [],
      title: 'Assistant',
      titleSource: 'user',
      archivedAt: null,
      createdAt: 1n,
      updatedAt: 1n
    })
  );
  api.chats.mockResolvedValue({ items: [], next: null });
  api.context.mockResolvedValue({
    estimatedTokens: 8000,
    maxTokens: 50000,
    autoCompact: true,
    lastCompactedAtMs: null
  });
  api.newChat.mockResolvedValue(
    Schema.decodeUnknownSync(noteSchema)({
      id: 92n,
      projectIds: [],
      title: 'Assistant',
      titleSource: 'user',
      archivedAt: null,
      createdAt: 2n,
      updatedAt: 2n
    })
  );
  api.thread.mockImplementation(async () => ({ items: messages, next: null }));
  api.progress.mockResolvedValue([]);
  api.provenance.mockResolvedValue({ state: 'available', requestId: 'reply' });
  api.executions.mockResolvedValue({ items: [], next: null });
  api.subscribe.mockImplementation(() => new Promise(() => {}));
  api.ask.mockImplementation(async (input) => {
    messages = [message('user', input.text, 1n), message('assistant', '', 2n, true)];

    return Schema.decodeUnknownSync(askResultSchema)({
      requestId: 'reply',
      noteId: 91n,
      messageId: 2n,
      versionId: 2n,
      userMessageId: 1n,
      userVersionId: 1n
    });
  });
});
afterEach(() => {
  for (const client of clients) client.clear();

  clients.length = 0;
});

export function mountAssistant() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
  });

  clients.push(client);

  return {
    ...render(
      <QueryClientProvider client={client}>
        <AssistantProvider>
          <Page />
        </AssistantProvider>
      </QueryClientProvider>
    ),
    client
  };
}

export { api };
