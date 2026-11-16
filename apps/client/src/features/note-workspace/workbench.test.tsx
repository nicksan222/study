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

function mount() {
  const client = AtomRegistry.make();

  caches.push(client);
  const fixture = test.rpcTestTransport(async () => api.thread(), client);
  const wrapper = fixture.wrapper;

  return {
    client,
    notify: fixture.notify,
    ...test.renderHook(({ noteId }) => useWorkbench(noteId), {
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

test.beforeEach(async ({ mock }) => {
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

test.beforeEach(() => {
  test.vi.resetAllMocks();
  api.thread.mockResolvedValue({ items: [], next: null });
});

test.afterEach(() => {
  test.cleanup();
  caches.splice(0).forEach((cache) => cache.dispose());
});

test.stable(
  'opens a persisted material once and refreshes a legacy page without converting a quick note',
  async () => {
    const view = mount();
    const target = {
      kind: 'page' as const,
      pageId: pageIdSchema.make(8n),
      title: 'Document'
    };

    await test.waitFor(() => test.expect(api.thread).toHaveBeenCalled());
    test.act(() => view.result.current.open(target));
    await test.waitFor(() => test.expect(view.result.current.tabs).toEqual([target]));
    test.act(() => view.result.current.hide());
    await test.waitFor(() => test.expect(view.result.current.visible).toBe(false));
    test.act(() => view.result.current.open(target));
    await test.waitFor(() => test.expect(view.result.current.visible).toBe(true));
    test.expect(view.result.current.tabs).toHaveLength(1);
    const message = persistedPage('legacy-page');

    test.act(() => view.result.current.open({ kind: 'message', message }));
    api.thread.mockResolvedValue({ items: [{ ...message, description: 'Updated' }], next: null });
    await test.act(async () => {
      await view.notify();
    });
    await test.waitFor(() =>
      test.expect(view.result.current.tabs[1]).toMatchObject({
        kind: 'message',
        message: { description: 'Updated' }
      })
    );
    test.expect(view.result.current.tabs[0]).toEqual(target);
  }
);

test.stable(
  'keeps tabs while hidden and selects the adjacent document when the active tab closes',
  async () => {
    const view = mount();
    const identities: string[] = [];

    for (const title of ['First', 'Second', 'Third']) {
      test.act(() =>
        view.result.current.open({
          kind: 'page',
          pageId: pageIdSchema.make(BigInt(identities.length + 1)),
          title
        })
      );
      await test.waitFor(() =>
        test.expect(view.result.current.tabs).toHaveLength(identities.length + 1)
      );
      identities.push(view.result.current.active!);
    }

    test.act(() => view.result.current.select(identities[1]!));
    await test.waitFor(() => test.expect(view.result.current.active).toBe(identities[1]));
    test.act(() => view.result.current.hide());
    await test.waitFor(() => test.expect(view.result.current.visible).toBe(false));
    test.expect(view.result.current.tabs.map(workbenchIdentity)).toEqual(identities);
    test.act(() => view.result.current.select(identities[1]!));
    await test.waitFor(() => test.expect(view.result.current.visible).toBe(true));
    test.act(() => view.result.current.close(identities[1]!));
    await test.waitFor(() => test.expect(view.result.current.active).toBe(identities[2]));
    test.act(() => view.result.current.close(identities[0]!));
    await test.waitFor(() => test.expect(view.result.current.tabs).toHaveLength(1));
    test.expect(view.result.current.active).toBe(identities[2]);
    test.act(() => view.result.current.close(identities[2]!));
    await test.waitFor(() => test.expect(view.result.current.tabs).toHaveLength(0));
    test.expect(view.result.current.visible).toBe(false);
    test.expect(view.result.current.active).toBeUndefined();
  }
);

test.stable('isolates page tabs by note and restores them when returning to the note', async () => {
  const view = mount();

  test.act(() =>
    view.result.current.open({
      kind: 'page',
      pageId: pageIdSchema.make(1n),
      title: 'First note page'
    })
  );
  await test.waitFor(() => test.expect(view.result.current.tabs).toHaveLength(1));
  const firstIdentity = view.result.current.active;

  view.rerender({ noteId: otherId });
  test.expect(view.result.current.tabs).toHaveLength(0);
  test.expect(view.result.current.visible).toBe(false);
  test.act(() =>
    view.result.current.open({
      kind: 'page',
      pageId: pageIdSchema.make(2n),
      title: 'Second note page'
    })
  );
  await test.waitFor(() => test.expect(view.result.current.tabs).toHaveLength(1));
  test.expect(view.result.current.active).not.toBe(firstIdentity);
  view.rerender({ noteId: id });
  test.expect(view.result.current.active).toBe(firstIdentity);
  test.expect(view.result.current.tabs).toHaveLength(1);
  test.expect(view.result.current.visible).toBe(true);
});

test.stable('uses the configured initial width until the user manually changes it', async () => {
  preferences.expandPages = true;
  const view = mount();

  test.expect(view.result.current.expanded).toBe(true);
  test.act(() => view.result.current.expand());
  await test.waitFor(() => test.expect(view.result.current.expanded).toBe(false));
  preferences.expandPages = false;
  view.rerender({ noteId: id });
  preferences.expandPages = true;
  view.rerender({ noteId: id });
  test.expect(view.result.current.expanded).toBe(false);
  preferences.expandPages = false;
});

test.stable(
  'keeps the action card visible until hidden and docks existing tabs without creating pages',
  async () => {
    const view = mount();

    await test.waitFor(() => test.expect(view.result.current.cardVisible).toBe(true));
    test.act(() => view.result.current.showEditor('bottom'));
    await test.waitFor(() => test.expect(view.result.current.visible).toBe(false));
    await test.waitFor(() => test.expect(view.result.current.tabs).toHaveLength(0));
    test.act(() => view.result.current.toggleCard());
    await test.waitFor(() => test.expect(view.result.current.cardVisible).toBe(false));
    const target = {
      kind: 'page' as const,
      pageId: pageIdSchema.make(88n),
      title: 'Existing document'
    };

    test.act(() => view.result.current.open(target));
    await test.waitFor(() => test.expect(view.result.current.cardVisible).toBe(false));
    test.act(() => view.result.current.hide());
    await test.waitFor(() => test.expect(view.result.current.cardVisible).toBe(false));
    test.act(() => view.result.current.toggleCard());
    await test.waitFor(() => test.expect(view.result.current.cardVisible).toBe(true));
    test.act(() => view.result.current.showEditor('bottom'));
    await test.waitFor(() => test.expect(view.result.current.dock).toBe('bottom'));
    await test.waitFor(() => test.expect(view.result.current.visible).toBe(true));
    await test.waitFor(() => test.expect(view.result.current.cardVisible).toBe(false));
    await test.waitFor(() => test.expect(view.result.current.tabs).toEqual([target]));
    test.act(() => view.result.current.showEditor('side'));
    await test.waitFor(() => test.expect(view.result.current.dock).toBe('side'));
    await test.waitFor(() => test.expect(view.result.current.tabs).toEqual([target]));
    test.act(() => view.result.current.close(workbenchIdentity(target)));
    await test.waitFor(() => test.expect(view.result.current.cardVisible).toBe(true));
  }
);

test.stable(
  'switches from an open editor back to its action card without dropping tabs',
  async () => {
    const view = mount();

    test.act(() => view.result.current.open({ kind: 'new', captureKey: 'draft-card', text: '' }));
    await test.waitFor(() => test.expect(view.result.current.cardVisible).toBe(false));
    test.act(() => view.result.current.toggleCard());
    await test.waitFor(() => test.expect(view.result.current.visible).toBe(false));
    await test.waitFor(() => test.expect(view.result.current.cardVisible).toBe(true));
    await test.waitFor(() => test.expect(view.result.current.tabs).toHaveLength(1));
  }
);

test.stable(
  'the note assistant is one document-style tab, survives hiding and stays scoped across note switches',
  async () => {
    const view = mount();

    test.act(() => view.result.current.open({ kind: 'assistant' }));
    test.act(() => view.result.current.open({ kind: 'assistant' }));
    await test.waitFor(() =>
      test.expect(view.result.current.tabs).toEqual([{ kind: 'assistant' }])
    );
    test.expect(view.result.current.active).toBe('assistant');
    test.act(() => view.result.current.hide());
    test.act(() => view.result.current.showEditor('side'));
    await test.waitFor(() => test.expect(view.result.current.visible).toBe(true));
    view.rerender({ noteId: otherId });
    await test.waitFor(() => test.expect(view.result.current.tabs).toEqual([]));
    view.rerender({ noteId: id });
    await test.waitFor(() =>
      test.expect(view.result.current.tabs).toEqual([{ kind: 'assistant' }])
    );
    test.act(() => view.result.current.close('assistant'));
    await test.waitFor(() => test.expect(view.result.current.tabs).toEqual([]));
  }
);
