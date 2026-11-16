import {
  StudyError,
  noteIdSchema,
  chatMessageSchema,
  defaultWorkspacePreferences
} from '@study/contracts';
import { RpcProvider, configureRpcTransport } from '@study/contracts/react';
import { test } from '@study/testing';
import { Schema } from 'effect';
import { AtomRegistry } from 'effect/reactivity';
import type { ReactNode } from 'react';

let usePageAutosave: typeof __MockType0.usePageAutosave;

import type { PageTarget } from './page-autosave.queries';
import type * as __MockType0 from './page-autosave.queries';

let preferences: ReturnType<typeof createMockState>['preferences'];

let api: ReturnType<typeof createMockState>['api'];

const id = noteIdSchema.make(1n);

const target: PageTarget = { kind: 'new', captureKey: 'page-test-capture' };

function message(text: string, versionId = 10n, basedOn: bigint | null = null) {
  return Schema.decodeUnknownSync(chatMessageSchema)({
    id: 2n,
    noteId: id,
    captureKey: 'page-test-capture',
    role: 'user',
    threadRoot: null,
    replyTo: null,
    activeVersionId: versionId,
    recordingId: null,
    recordingMs: null,
    recordedIn: null,
    createdAt: 1n,
    versions: [
      {
        id: versionId,
        number: basedOn ? 2n : 1n,
        origin: basedOn ? 'edited' : 'typed',
        status: 'complete',
        text,
        basedOn,
        instruction: null,
        createdAt: 1n
      }
    ],
    parts: [],
    citations: []
  });
}

const registries: AtomRegistry.AtomRegistry[] = [];

function mount(page: PageTarget = target, registry = AtomRegistry.make()) {
  registries.push(registry);
  const fixture = test.rpcTestTransport(async (tag, input) => {
    if (tag === 'notes.postMessage') return api.post(input);

    if (tag === 'notes.editMessage') return api.edit(input);

    if (tag === 'notes.message') return api.message(input);

    throw new Error(`Unexpected ${tag}`);
  });

  configureRpcTransport(fixture.transport);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <RpcProvider transport={fixture.transport} registry={registry}>
      {children}
    </RpcProvider>
  );

  return { registry, ...test.renderHook(() => usePageAutosave(id, page), { wrapper }) };
}

function createMockState(mock: test.Mock) {
  return {
    preferences: (() => ({ autosaveIntervalSeconds: 3 }))(),
    api: (() => ({ post: mock.fn(), edit: mock.fn(), message: mock.fn() }))()
  };
}

test.beforeEach(async ({ mock }) => {
  const __mockState = createMockState(mock);

  preferences = __mockState.preferences;
  api = __mockState.api;

  mock('#client/lib/study-client/workspace-preferences.queries.ts', () => ({
    useWorkspacePreferences: () => ({ ...defaultWorkspacePreferences, ...preferences })
  }));
  const __mockModule0 = await import('./page-autosave.queries');

  usePageAutosave = __mockModule0.usePageAutosave;
});

test.beforeEach(() => {
  test.vi.useFakeTimers();
  test.vi.resetAllMocks();
});
test.afterEach(() => {
  test.cleanup();
  registries.splice(0).forEach((registry) => registry.dispose());
  test.vi.useRealTimers();
});

test.stable(
  'autosaves every three seconds, serializes writes and preserves typing during a pending save',
  async () => {
    let accept!: (value: ReturnType<typeof message>) => void;

    api.post.mockReturnValue(
      new Promise((resolve) => {
        accept = resolve;
      })
    );
    api.edit.mockResolvedValue(message('Later typing', 11n, 10n));
    const view = mount();

    test.act(() => view.result.current.setText('# First page'));
    await test.act(async () => {
      await test.vi.advanceTimersByTimeAsync(3000);
    });
    test.expect(api.post).toHaveBeenCalledExactlyOnceWith({
      noteId: id,
      captureKey: 'page-test-capture',
      text: '# First page',
      format: 'document',
      requestReply: false
    });
    test.act(() => view.result.current.setText('Later typing'));
    await test.act(async () => {
      await test.vi.advanceTimersByTimeAsync(6000);
    });
    test.expect(api.post).toHaveBeenCalledTimes(1);
    await test.act(async () => {
      accept(message('# First page'));
    });
    test.expect(view.result.current.draft.text).toBe('Later typing');
    await test.act(async () => {
      await test.vi.advanceTimersByTimeAsync(3000);
    });
    test.expect(api.edit).toHaveBeenCalledExactlyOnceWith({
      messageId: 2n,
      text: 'Later typing',
      expectedActiveVersionId: 10n
    });
  }
);

test.stable(
  'retains an uncertain creation across remounts and retries its exact capture identity only on request',
  async () => {
    api.post
      .mockRejectedValueOnce(new StudyError('transient', 'offline'))
      .mockResolvedValueOnce(message('Original'));
    const first = mount();

    test.act(() => first.result.current.setText('Original'));
    await test.act(async () => {
      await test.vi.advanceTimersByTimeAsync(3000);
    });
    first.unmount();
    const next = mount(target, first.registry);

    await test.act(async () => {
      await test.vi.advanceTimersByTimeAsync(9000);
    });
    test.expect(api.post).toHaveBeenCalledTimes(1);
    await test.act(async () => {
      await next.result.current.save();
      await test.vi.advanceTimersByTimeAsync(1);
    });
    test.expect(api.post.mock.calls[1]).toEqual(api.post.mock.calls[0]);
    test.expect(next.result.current.draft.error).toBeUndefined();
  }
);

test.stable('keeps local changes when another writer advances the active version', async () => {
  api.edit.mockRejectedValue(new StudyError('invalid_input', 'conflict'));
  api.message.mockResolvedValue(message('Other writer', 11n, 10n));
  const view = mount({ kind: 'message', message: message('Original') });

  test.act(() => view.result.current.setText('My changes'));
  await test.act(async () => {
    await test.vi.advanceTimersByTimeAsync(3000);
  });
  test.expect(view.result.current.draft.text).toBe('My changes');
  await test.act(async () => {
    await test.vi.advanceTimersByTimeAsync(1);
  });
  test.expect(view.result.current.draft.conflict?.activeVersionId).toBe(11n);
  await test.act(async () => {
    await test.vi.advanceTimersByTimeAsync(9000);
  });
  test.expect(api.edit).toHaveBeenCalledTimes(1);
});

test.stable('flushes edits typed during a save when their document tab closes', async () => {
  let accept!: (value: ReturnType<typeof message>) => void;

  api.post.mockReturnValue(
    new Promise((resolve) => {
      accept = resolve;
    })
  );
  api.edit.mockResolvedValue(message('Final text', 11n, 10n));
  const view = mount();

  test.act(() => view.result.current.setText('First text'));
  await test.act(async () => {
    await test.vi.advanceTimersByTimeAsync(3000);
  });
  test.act(() => view.result.current.setText('Final text'));
  view.unmount();
  await test.act(async () => {
    accept(message('First text'));
  });
  test.expect(api.post).toHaveBeenCalledTimes(1);
  test.expect(api.edit).toHaveBeenCalledExactlyOnceWith({
    messageId: 2n,
    text: 'Final text',
    expectedActiveVersionId: 10n
  });
});

test.stable('reconciles a lost edit receipt without creating a duplicate version', async () => {
  api.edit.mockRejectedValue(new StudyError('transient', 'Lost receipt'));
  api.message.mockResolvedValue(message('Updated text', 11n, 10n));
  const view = mount({ kind: 'message', message: message('Original') });

  test.act(() => view.result.current.setText('Updated text'));
  await test.act(async () => {
    await test.vi.advanceTimersByTimeAsync(3001);
  });
  test.expect(view.result.current.draft.error).toBeUndefined();
  test.expect(view.result.current.draft.savedText).toBe('Updated text');
  await test.act(async () => {
    await test.vi.advanceTimersByTimeAsync(9000);
  });
  test.expect(api.edit).toHaveBeenCalledTimes(1);
});

test.stable('waits for the configured autosave interval before creating a page', async () => {
  preferences.autosaveIntervalSeconds = 8;
  api.post.mockResolvedValue(message('Longer pause'));
  const view = mount();

  test.act(() => view.result.current.setText('Longer pause'));
  await test.act(async () => {
    await test.vi.advanceTimersByTimeAsync(7999);
  });
  test.expect(api.post).not.toHaveBeenCalled();
  await test.act(async () => {
    await test.vi.advanceTimersByTimeAsync(1);
  });
  test.expect(api.post).toHaveBeenCalledTimes(1);
  preferences.autosaveIntervalSeconds = 3;
});
