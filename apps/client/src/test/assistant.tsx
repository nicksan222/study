import {
  assistantAskInputSchema,
  chatMessageSchema,
  askResultSchema,
  noteSchema
} from '@study/contracts';
import type { ChatMessage } from '@study/contracts';
import { rpcTestTransport } from '@study/contracts/react/testing';
import type { test } from '@study/testing';
import { render } from '@testing-library/react';
import { Schema } from 'effect';

function message(
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

export function createAssistantHarness(mock: test.Mock) {
  const api = {
    note: mock.fn(),
    chats: mock.fn(),
    context: mock.fn(),
    newChat: mock.fn(),
    thread: mock.fn(),
    ask: mock.fn<
      (input: typeof assistantAskInputSchema.Type) => Promise<typeof askResultSchema.Type>
    >(),
    provenance: mock.fn(),
    progress: mock.fn(),
    executions: mock.fn(),
    reanswer: mock.fn(),
    cancel: mock.fn()
  };
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
  const views = new Set<ReturnType<typeof render>>();

  async function mountAssistant() {
    const [{ AssistantProvider }, { Page }] = await Promise.all([
      import('#client/features/assistant/note.tsx'),
      import('#client/pages/assistant/page.tsx')
    ]);
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

    const view = render(
      <AssistantProvider>
        <Page />
      </AssistantProvider>,
      { wrapper: fixture.wrapper }
    );

    views.add(view);

    return { ...view, notify: fixture.notify };
  }

  return {
    api,
    message,
    mountAssistant,
    close() {
      for (const view of views) view.unmount();

      views.clear();
    }
  };
}

export type AssistantHarness = ReturnType<typeof createAssistantHarness>;
