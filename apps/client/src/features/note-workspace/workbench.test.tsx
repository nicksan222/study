import {
  noteIdSchema,
  pageIdSchema,
  chatMessageSchema,
  defaultWorkspacePreferences
} from '@study/contracts';
import { test } from '@study/testing';
import { Schema } from 'effect';
import { AtomRegistry } from 'effect/reactivity';

import type * as __MockType0 from './workbench.queries';

let useWorkbench: typeof __MockType0.useWorkbench;

let workbenchIdentity: typeof __MockType0.workbenchIdentity;

let preferences: ReturnType<typeof createMockState>['preferences'];

let api: ReturnType<typeof createMockState>['api'];

const id = noteIdSchema.make(1n);

const otherId = noteIdSchema.make(2n);

const caches: AtomRegistry.AtomRegistry[] = [];

function mount({
  rpcTestTransport,
  renderHook
}: Pick<test.unit.Context, 'rpcTestTransport' | 'renderHook'>) {
  const client = AtomRegistry.make();

  caches.push(client);
  const fixture = rpcTestTransport(async () => api.thread(), client);
  const wrapper = fixture.wrapper;

  return {
    client,
    notify: fixture.notify,
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

function createMockState(mock: test.Mock) {
  return {
    preferences: (() => ({ expandPages: false }))(),
    api: (() => ({ thread: mock.fn() }))()
  };
}

test.unit.beforeEach(async ({ mock }) => {
  const __mockState = createMockState(mock);

  preferences = __mockState.preferences;
  api = __mockState.api;

  mock('#client/lib/study-client/workspace-preferences.queries.ts', () => ({
    useWorkspacePreferences: () => ({ ...defaultWorkspacePreferences, ...preferences })
  }));
  const __mockModule0 = await import('./workbench.queries');

  useWorkbench = __mockModule0.useWorkbench;
  workbenchIdentity = __mockModule0.workbenchIdentity;
});

test.unit.beforeEach(({ vi }) => {
  vi.resetAllMocks();
  api.thread.mockResolvedValue({ items: [], next: null });
});

test.unit.afterEach(({ cleanup }) => {
  cleanup();
  caches.splice(0).forEach((cache) => cache.dispose());
});

test.unit.stable(
  'opens a persisted material once and refreshes a legacy page without converting a quick note',
  async ({ waitFor, expect, act, rpcTestTransport, renderHook }) => {
    const view = mount({ rpcTestTransport, renderHook });
    const target = {
      kind: 'page' as const,
      pageId: pageIdSchema.make(8n),
      title: 'Document'
    };

    await waitFor(() => expect(api.thread).toHaveBeenCalled());
    act(() => view.result.current.open(target));
    await waitFor(() => expect(view.result.current.tabs).toEqual([target]));
    act(() => view.result.current.hide());
    await waitFor(() => expect(view.result.current.visible).toBe(false));
    act(() => view.result.current.open(target));
    await waitFor(() => expect(view.result.current.visible).toBe(true));
    expect(view.result.current.tabs).toHaveLength(1);
    const message = persistedPage('legacy-page');

    act(() => view.result.current.open({ kind: 'message', message }));
    api.thread.mockResolvedValue({ items: [{ ...message, description: 'Updated' }], next: null });
    await act(async () => {
      await view.notify();
    });
    await waitFor(() =>
      expect(view.result.current.tabs[1]).toMatchObject({
        kind: 'message',
        message: { description: 'Updated' }
      })
    );
    expect(view.result.current.tabs[0]).toEqual(target);
  }
);

test.unit.stable(
  'keeps tabs while hidden and selects the adjacent document when the active tab closes',
  async ({ act, waitFor, expect, rpcTestTransport, renderHook }) => {
    const view = mount({ rpcTestTransport, renderHook });
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

test.unit.stable(
  'isolates page tabs by note and restores them when returning to the note',
  async ({ act, waitFor, expect, rpcTestTransport, renderHook }) => {
    const view = mount({ rpcTestTransport, renderHook });

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
  }
);

test.unit.stable(
  'uses the configured initial width until the user manually changes it',
  async ({ expect, act, waitFor, rpcTestTransport, renderHook }) => {
    preferences.expandPages = true;
    const view = mount({ rpcTestTransport, renderHook });

    expect(view.result.current.expanded).toBe(true);
    act(() => view.result.current.expand());
    await waitFor(() => expect(view.result.current.expanded).toBe(false));
    preferences.expandPages = false;
    view.rerender({ noteId: id });
    preferences.expandPages = true;
    view.rerender({ noteId: id });
    expect(view.result.current.expanded).toBe(false);
    preferences.expandPages = false;
  }
);

test.unit.stable(
  'keeps the action card visible until hidden and docks existing tabs without creating pages',
  async ({ waitFor, expect, act, rpcTestTransport, renderHook }) => {
    const view = mount({ rpcTestTransport, renderHook });

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

test.unit.stable(
  'switches from an open editor back to its action card without dropping tabs',
  async ({ act, waitFor, expect, rpcTestTransport, renderHook }) => {
    const view = mount({ rpcTestTransport, renderHook });

    act(() => view.result.current.open({ kind: 'new', captureKey: 'draft-card', text: '' }));
    await waitFor(() => expect(view.result.current.cardVisible).toBe(false));
    act(() => view.result.current.toggleCard());
    await waitFor(() => expect(view.result.current.visible).toBe(false));
    await waitFor(() => expect(view.result.current.cardVisible).toBe(true));
    await waitFor(() => expect(view.result.current.tabs).toHaveLength(1));
  }
);

test.unit.stable(
  'the note assistant is one document-style tab, survives hiding and stays scoped across note switches',
  async ({ act, waitFor, expect, rpcTestTransport, renderHook }) => {
    const view = mount({ rpcTestTransport, renderHook });

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

test.unit.stable(
  'starts phone notes with reading visible and opens the context card on request',
  async ({ vi, act, waitFor, expect, rpcTestTransport, renderHook }) => {
    const media = window.matchMedia('(max-width: 600px)');

    vi.spyOn(window, 'matchMedia').mockReturnValue({ ...media, matches: true });
    const view = mount({ rpcTestTransport, renderHook });

    await waitFor(() => expect(view.result.current.cardVisible).toBe(false));
    act(() => view.result.current.toggleCard());
    await waitFor(() => expect(view.result.current.cardVisible).toBe(true));
    act(() => view.result.current.toggleCard());
    await waitFor(() => expect(view.result.current.cardVisible).toBe(false));
  }
);
