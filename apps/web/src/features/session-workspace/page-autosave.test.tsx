import { chatMessageSchema } from '@study/contracts/conversations/schemas';
import { StudyError } from '@study/contracts/errors';
import { sessionIdSchema } from '@study/contracts/ids';
import { defaultWorkspacePreferences } from '@study/contracts/settings/types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, cleanup } from '@testing-library/react';
import { Schema } from 'effect';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vite-plus/test';

import { usePageAutosave } from './page-autosave.queries';
import type { PageTarget } from './page-autosave.queries';

const preferences = vi.hoisted(() => ({ autosaveIntervalSeconds: 3 }));

vi.mock('../../lib/study-client/workspace-preferences.queries', () => ({
  useWorkspacePreferences: () => ({ ...defaultWorkspacePreferences, ...preferences })
}));

const api = vi.hoisted(() => ({ post: vi.fn(), edit: vi.fn(), message: vi.fn() }));

vi.mock('../../lib/study-client/request', () => ({
  request: (invoke: (rpc: Record<string, unknown>) => unknown) =>
    invoke({
      'conversations.postMessage': api.post,
      'conversations.editMessage': api.edit,
      'conversations.message': api.message
    })
}));

const id = sessionIdSchema.make(1n);

const target: PageTarget = { kind: 'new', captureKey: 'page-test-capture' };

function message(text: string, versionId = 10n, basedOn: bigint | null = null) {
  return Schema.decodeUnknownSync(chatMessageSchema)({
    id: 2n,
    sessionId: id,
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

const caches: QueryClient[] = [];

function mount(
  page: PageTarget = target,
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
) {
  caches.push(client);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );

  return { client, ...renderHook(() => usePageAutosave(id, page), { wrapper }) };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetAllMocks();
});
afterEach(() => {
  cleanup();
  caches.splice(0).forEach((cache) => cache.clear());
  vi.useRealTimers();
});

it('autosaves every three seconds, serializes writes and preserves typing during a pending save', async () => {
  let accept!: (value: ReturnType<typeof message>) => void;

  api.post.mockReturnValue(
    new Promise((resolve) => {
      accept = resolve;
    })
  );
  api.edit.mockResolvedValue(message('Later typing', 11n, 10n));
  const view = mount();

  act(() => view.result.current.setText('# First page'));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(3000);
  });
  expect(api.post).toHaveBeenCalledExactlyOnceWith({
    sessionId: id,
    captureKey: 'page-test-capture',
    text: '# First page',
    format: 'document',
    requestReply: false
  });
  act(() => view.result.current.setText('Later typing'));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(6000);
  });
  expect(api.post).toHaveBeenCalledTimes(1);
  await act(async () => {
    accept(message('# First page'));
  });
  expect(view.result.current.draft.text).toBe('Later typing');
  await act(async () => {
    await vi.advanceTimersByTimeAsync(3000);
  });
  expect(api.edit).toHaveBeenCalledExactlyOnceWith({
    messageId: 2n,
    text: 'Later typing',
    expectedActiveVersionId: 10n
  });
});

it('retains an uncertain creation across remounts and retries its exact capture identity only on request', async () => {
  api.post
    .mockRejectedValueOnce(new StudyError('transient', 'offline'))
    .mockResolvedValueOnce(message('Original'));
  const first = mount();

  act(() => first.result.current.setText('Original'));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(3000);
  });
  first.unmount();
  const next = mount(target, first.client);

  await act(async () => {
    await vi.advanceTimersByTimeAsync(9000);
  });
  expect(api.post).toHaveBeenCalledTimes(1);
  await act(async () => {
    await next.result.current.save();
    await vi.advanceTimersByTimeAsync(1);
  });
  expect(api.post.mock.calls[1]).toEqual(api.post.mock.calls[0]);
  expect(next.result.current.draft.error).toBeUndefined();
});

it('keeps local changes when another writer advances the active version', async () => {
  api.edit.mockRejectedValue(new StudyError('invalid_input', 'conflict'));
  api.message.mockResolvedValue(message('Other writer', 11n, 10n));
  const view = mount({ kind: 'message', message: message('Original') });

  act(() => view.result.current.setText('My changes'));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(3000);
  });
  expect(view.result.current.draft.text).toBe('My changes');
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
  expect(view.result.current.draft.conflict?.activeVersionId).toBe(11n);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(9000);
  });
  expect(api.edit).toHaveBeenCalledTimes(1);
});

it('flushes edits typed during a save when their document tab closes', async () => {
  let accept!: (value: ReturnType<typeof message>) => void;

  api.post.mockReturnValue(
    new Promise((resolve) => {
      accept = resolve;
    })
  );
  api.edit.mockResolvedValue(message('Final text', 11n, 10n));
  const view = mount();

  act(() => view.result.current.setText('First text'));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(3000);
  });
  act(() => view.result.current.setText('Final text'));
  view.unmount();
  await act(async () => {
    accept(message('First text'));
  });
  expect(api.post).toHaveBeenCalledTimes(1);
  expect(api.edit).toHaveBeenCalledExactlyOnceWith({
    messageId: 2n,
    text: 'Final text',
    expectedActiveVersionId: 10n
  });
});

it('reconciles a lost edit receipt without creating a duplicate version', async () => {
  api.edit.mockRejectedValue(new StudyError('transient', 'Lost receipt'));
  api.message.mockResolvedValue(message('Updated text', 11n, 10n));
  const view = mount({ kind: 'message', message: message('Original') });

  act(() => view.result.current.setText('Updated text'));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(3001);
  });
  expect(view.result.current.draft.error).toBeUndefined();
  expect(view.result.current.draft.savedText).toBe('Updated text');
  await act(async () => {
    await vi.advanceTimersByTimeAsync(9000);
  });
  expect(api.edit).toHaveBeenCalledTimes(1);
});

it('waits for the configured autosave interval before creating a page', async () => {
  preferences.autosaveIntervalSeconds = 8;
  api.post.mockResolvedValue(message('Longer pause'));
  const view = mount();

  act(() => view.result.current.setText('Longer pause'));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(7999);
  });
  expect(api.post).not.toHaveBeenCalled();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
  expect(api.post).toHaveBeenCalledTimes(1);
  preferences.autosaveIntervalSeconds = 3;
});
