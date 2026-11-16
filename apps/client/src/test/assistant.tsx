import {
  assistantAskInputSchema,
  chatMessageSchema,
  askResultSchema,
  noteSchema
} from '@study/contracts';
import type { ChatMessage } from '@study/contracts';
import { rpcTestTransport } from '@study/contracts/react/testing';
import { test } from '@study/testing';
import { render } from '@testing-library/react';
import { Schema } from 'effect';

import { AssistantProvider } from '#client/features/assistant/note.tsx';
import { Page } from '#client/pages/assistant/page.tsx';

const api = test.hoisted(() => ({
  note: test.vi.fn(),
  chats: test.vi.fn(),
  context: test.vi.fn(),
  newChat: test.vi.fn(),
  thread: test.vi.fn(),
  ask: test.vi.fn<
    (input: typeof assistantAskInputSchema.Type) => Promise<typeof askResultSchema.Type>
  >(),
  provenance: test.vi.fn(),
  progress: test.vi.fn(),
  executions: test.vi.fn(),
  reanswer: test.vi.fn(),
  cancel: test.vi.fn()
}));

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

test.beforeEach(() => {
  test.vi.clearAllMocks();
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

export function mountAssistant() {
  const handlers: Record<string, (input: unknown) => Promise<unknown>> = {
    'notes.assistantNote': api.note,
    'notes.assistantChats': api.chats,
    'notes.assistantContext': api.context,
    'notes.newAssistantNote': api.newChat,
    'notes.thread': api.thread,
    'notes.assistantAsk': (input) =>
      api.ask(Schema.decodeUnknownSync(assistantAskInputSchema)(input)),
    'notes.replyVersion': api.provenance,
    'workflows.agentProgress': api.progress,
    'notes.reanswer': api.reanswer,
    'workflows.executions': api.executions,
    'workflows.cancelExecution': api.cancel,
    'auth.status': async () => ({ signedIn: false, email: null, sharing: false }),
    'projects.projects': async () => ({ items: [], next: null }),
    'notes.notes': async () => ({ items: [], next: null })
  };
  const fixture = rpcTestTransport(async (tag, input) => {
    const handler = handlers[tag];

    if (!handler) throw new Error(`Unexpected endpoint ${tag}`);

    return handler(input);
  });

  return {
    ...render(
      <AssistantProvider>
        <Page />
      </AssistantProvider>,
      { wrapper: fixture.wrapper }
    ),
    notify: fixture.notify
  };
}

export { api };
