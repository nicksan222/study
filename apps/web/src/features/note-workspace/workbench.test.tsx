import { noteIdSchema, pageIdSchema } from '@study/contracts/ids';
import { chatMessageSchema } from '@study/contracts/notes/schemas';
import { defaultWorkspacePreferences } from '@study/contracts/settings/types';
import { testStable } from '@study/testing/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { Schema } from 'effect';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, expect, vi } from 'vite-plus/test';

import { threadOptions } from './note-workspace.queries';
import { useWorkbench, workbenchIdentity } from './workbench.queries';

const preferences = vi.hoisted(() => ({ expandPages: false }));

vi.mock('#web/lib/study-client/workspace-preferences.queries.ts', () => ({
  useWorkspacePreferences: () => ({ ...defaultWorkspacePreferences, ...preferences })
}));

const api = vi.hoisted(() => ({ thread: vi.fn() }));

vi.mock('#web/lib/study-client/request.ts', () => ({
  request: (invoke: (rpc: Record<string, unknown>) => unknown) =>
    invoke({ 'notes.thread': api.thread })
}));

const id = noteIdSchema.make(1n);

const otherId = noteIdSchema.make(2n);

const caches: QueryClient[] = [];

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  caches.push(client);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );

  return {
    client,
    ...renderHook(({ noteId }) => useWorkbench(noteId), {
      wrapper,
      initialProps: { noteId: id }
    })
  };
}

function persistedPage(captureKey: string) {
  return Schema.decodeUnknownSync(chatMessageSchema)({
    id: 3n,
    noteId: id,
    captureKey,
    role: 'user',
    threadRoot: null,
    replyTo: null,
    activeVersionId: 4n,
    recordingId: null,
    recordingMs: null,
    recordedIn: null,
    createdAt: 1n,
    versions: [
      {
        id: 4n,
        number: 1n,
        origin: 'typed',
        status: 'complete',
        text: '# Saved page',
        basedOn: null,
        instruction: null,
        createdAt: 1n
      }
    ],
    parts: [],
    citations: []
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  api.thread.mockResolvedValue({ items: [], next: null });
});

afterEach(() => {
  cleanup();
  caches.splice(0).forEach((cache) => cache.clear());
});

testStable(
  'opens a persisted material once and refreshes a legacy page without converting a quick note',
  async () => {
    const view = mount();
    const target = {
      kind: 'page' as const,
      pageId: pageIdSchema.make(8n),
      title: 'Document'
    };

    await waitFor(() => expect(view.client.isFetching()).toBe(0));
    act(() => view.result.current.open(target));
    await waitFor(() => expect(view.result.current.tabs).toEqual([target]));
    act(() => view.result.current.hide());
    await waitFor(() => expect(view.result.current.visible).toBe(false));
    act(() => view.result.current.open(target));
    await waitFor(() => expect(view.result.current.visible).toBe(true));
    expect(view.result.current.tabs).toHaveLength(1);
    const message = persistedPage('legacy-page');

    act(() => view.result.current.open({ kind: 'message', message }));
    act(() =>
      view.client.setQueryData(threadOptions(id).queryKey, {
        pages: [{ items: [{ ...message, description: 'Updated' }], next: null }],
        pageParams: [undefined]
      })
    );
    await waitFor(() =>
      expect(view.result.current.tabs[1]).toMatchObject({
        kind: 'message',
        message: { description: 'Updated' }
      })
    );
    expect(view.result.current.tabs[0]).toEqual(target);
  }
);

testStable(
  'keeps tabs while hidden and selects the adjacent document when the active tab closes',
  async () => {
    const view = mount();
    const identities: string[] = [];

    for (const title of ['First', 'Second', 'Third']) {
      act(() =>
        view.result.current.open({
          kind: 'page',
          pageId: pageIdSchema.make(BigInt(identities.length + 1)),
          title
        })
      );
      await waitFor(() => expect(view.result.current.tabs).toHaveLength(identities.length + 1));
      identities.push(view.result.current.active!);
    }

    act(() => view.result.current.select(identities[1]!));
    await waitFor(() => expect(view.result.current.active).toBe(identities[1]));
    act(() => view.result.current.hide());
    await waitFor(() => expect(view.result.current.visible).toBe(false));
    expect(view.result.current.tabs.map(workbenchIdentity)).toEqual(identities);
    act(() => view.result.current.select(identities[1]!));
    await waitFor(() => expect(view.result.current.visible).toBe(true));
    act(() => view.result.current.close(identities[1]!));
    await waitFor(() => expect(view.result.current.active).toBe(identities[2]));
    act(() => view.result.current.close(identities[0]!));
    await waitFor(() => expect(view.result.current.tabs).toHaveLength(1));
    expect(view.result.current.active).toBe(identities[2]);
    act(() => view.result.current.close(identities[2]!));
    await waitFor(() => expect(view.result.current.tabs).toHaveLength(0));
    expect(view.result.current.visible).toBe(false);
    expect(view.result.current.active).toBeUndefined();
  }
);

testStable('isolates page tabs by note and restores them when returning to the note', async () => {
  const view = mount();

  act(() =>
    view.result.current.open({
      kind: 'page',
      pageId: pageIdSchema.make(1n),
      title: 'First note page'
    })
  );
  await waitFor(() => expect(view.result.current.tabs).toHaveLength(1));
  const firstIdentity = view.result.current.active;

  view.rerender({ noteId: otherId });
  expect(view.result.current.tabs).toHaveLength(0);
  expect(view.result.current.visible).toBe(false);
  act(() =>
    view.result.current.open({
      kind: 'page',
      pageId: pageIdSchema.make(2n),
      title: 'Second note page'
    })
  );
  await waitFor(() => expect(view.result.current.tabs).toHaveLength(1));
  expect(view.result.current.active).not.toBe(firstIdentity);
  view.rerender({ noteId: id });
  expect(view.result.current.active).toBe(firstIdentity);
  expect(view.result.current.tabs).toHaveLength(1);
  expect(view.result.current.visible).toBe(true);
});

testStable('uses the configured initial width until the user manually changes it', async () => {
  preferences.expandPages = true;
  const view = mount();

  expect(view.result.current.expanded).toBe(true);
  act(() => view.result.current.expand());
  await waitFor(() => expect(view.result.current.expanded).toBe(false));
  preferences.expandPages = false;
  view.rerender({ noteId: id });
  preferences.expandPages = true;
  view.rerender({ noteId: id });
  expect(view.result.current.expanded).toBe(false);
  preferences.expandPages = false;
});

testStable(
  'keeps the action card visible until hidden and docks existing tabs without creating pages',
  async () => {
    const view = mount();

    await waitFor(() => expect(view.result.current.cardVisible).toBe(true));
    act(() => view.result.current.showEditor('bottom'));
    await waitFor(() => expect(view.result.current.visible).toBe(false));
    await waitFor(() => expect(view.result.current.tabs).toHaveLength(0));
    act(() => view.result.current.toggleCard());
    await waitFor(() => expect(view.result.current.cardVisible).toBe(false));
    const target = {
      kind: 'page' as const,
      pageId: pageIdSchema.make(88n),
      title: 'Existing document'
    };

    act(() => view.result.current.open(target));
    await waitFor(() => expect(view.result.current.cardVisible).toBe(false));
    act(() => view.result.current.hide());
    await waitFor(() => expect(view.result.current.cardVisible).toBe(false));
    act(() => view.result.current.toggleCard());
    await waitFor(() => expect(view.result.current.cardVisible).toBe(true));
    act(() => view.result.current.showEditor('bottom'));
    await waitFor(() => expect(view.result.current.dock).toBe('bottom'));
    await waitFor(() => expect(view.result.current.visible).toBe(true));
    await waitFor(() => expect(view.result.current.cardVisible).toBe(false));
    await waitFor(() => expect(view.result.current.tabs).toEqual([target]));
    act(() => view.result.current.showEditor('side'));
    await waitFor(() => expect(view.result.current.dock).toBe('side'));
    await waitFor(() => expect(view.result.current.tabs).toEqual([target]));
    act(() => view.result.current.close(workbenchIdentity(target)));
    await waitFor(() => expect(view.result.current.cardVisible).toBe(true));
  }
);

testStable(
  'switches from an open editor back to its action card without dropping tabs',
  async () => {
    const view = mount();

    act(() => view.result.current.open({ kind: 'new', captureKey: 'draft-card', text: '' }));
    await waitFor(() => expect(view.result.current.cardVisible).toBe(false));
    act(() => view.result.current.toggleCard());
    await waitFor(() => expect(view.result.current.visible).toBe(false));
    await waitFor(() => expect(view.result.current.cardVisible).toBe(true));
    await waitFor(() => expect(view.result.current.tabs).toHaveLength(1));
  }
);

testStable(
  'the note assistant is one document-style tab, survives hiding and stays scoped across note switches',
  async () => {
    const view = mount();

    act(() => view.result.current.open({ kind: 'assistant' }));
    act(() => view.result.current.open({ kind: 'assistant' }));
    await waitFor(() => expect(view.result.current.tabs).toEqual([{ kind: 'assistant' }]));
    expect(view.result.current.active).toBe('assistant');
    act(() => view.result.current.hide());
    act(() => view.result.current.showEditor('side'));
    await waitFor(() => expect(view.result.current.visible).toBe(true));
    view.rerender({ noteId: otherId });
    await waitFor(() => expect(view.result.current.tabs).toEqual([]));
    view.rerender({ noteId: id });
    await waitFor(() => expect(view.result.current.tabs).toEqual([{ kind: 'assistant' }]));
    act(() => view.result.current.close('assistant'));
    await waitFor(() => expect(view.result.current.tabs).toEqual([]));
  }
);
