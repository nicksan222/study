import { StudyError } from '@study/contracts/errors';
import { noteIdSchema, projectIdSchema, pageVersionIdSchema } from '@study/contracts/ids';
import { plainBlock } from '@study/contracts/sources/document';
import { testStable } from '@study/testing/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, cleanup } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, expect, vi } from 'vite-plus/test';

import { blankDocument } from '../document-editing';
import { authoredPage } from '../document-editing/test-support';
import {
  useNotePageCreation,
  useBlankPageCreation,
  useNotePageAutosave,
  linkedPagesOptions
} from './note-page.queries';

const api = vi.hoisted(() => ({
  create: vi.fn(),
  save: vi.fn(),
  material: vi.fn(),
  list: vi.fn()
}));

vi.mock('#web/lib/study-client/request.ts', () => ({
  request: (invoke: (rpc: Record<string, unknown>) => unknown) =>
    invoke({
      'pages.create': api.create,
      'pages.save': api.save,
      'pages.page': api.material,
      'pages.pages': api.list
    })
}));

const id = noteIdSchema.make(1n);

const document = (text: string) => ({
  ...blankDocument(),
  blocks: [plainBlock('paragraph', text, { type: 'authored' })]
});

const material = (text = '', versionId = 10n) => authoredPage(2n, text, versionId);

const caches: QueryClient[] = [];

function mount<T>(
  hook: () => T,
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
) {
  caches.push(client);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );

  return { client, ...renderHook(hook, { wrapper }) };
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

async function settle() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
}

testStable(
  'creates an empty real document attachment and reuses the exact creation receipt after uncertain transport',
  async () => {
    api.create
      .mockRejectedValueOnce(new StudyError('transient', 'offline'))
      .mockResolvedValueOnce(material());
    const view = mount(() => useNotePageCreation(id));

    await act(async () => {
      await view.result.current.create('New document');
    });
    const input = api.create.mock.calls[0]![0];

    expect(input).toMatchObject({
      noteId: id,
      title: 'New document',
      document: { blocks: [{ text: '' }] }
    });
    expect(input.createKey).toBeTruthy();
    await settle();
    expect(view.result.current.error).toBeDefined();
    await act(async () => {
      await view.result.current.retry();
    });
    expect(api.create.mock.calls[1]![0]).toEqual(input);
    await settle();
    expect(view.result.current.error).toBeUndefined();
  }
);

testStable('autosaves typed pages and flushes trailing edits after the tab closes', async () => {
  let finish!: (value: {
    outcome: 'saved';
    submittedVersionId: ReturnType<typeof pageVersionIdSchema.make>;
  }) => void;

  api.save
    .mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      })
    )
    .mockResolvedValue({
      outcome: 'saved',
      submittedVersionId: pageVersionIdSchema.make(12n)
    });
  const initial = material();
  const view = mount(() => useNotePageAutosave(initial));
  const first = document('First');
  const last = document('Last');

  act(() => view.result.current.change(first));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(3000);
  });
  expect(api.save.mock.calls[0]![0]).toMatchObject({
    pageId: initial.id,
    expectedVersionId: initial.version!.id,
    document: first
  });
  act(() => view.result.current.change(last));
  view.unmount();
  await act(async () => {
    finish({ outcome: 'saved', submittedVersionId: pageVersionIdSchema.make(11n) });
  });
  expect(api.save).toHaveBeenCalledTimes(2);
  expect(api.save.mock.calls[1]![0]).toMatchObject({ document: last, expectedVersionId: 11n });
});

testStable(
  'preserves a failed save payload and requires an explicit retry with the same save key',
  async () => {
    api.save
      .mockRejectedValueOnce(new StudyError('transient', 'lost receipt'))
      .mockResolvedValueOnce({
        outcome: 'saved',
        submittedVersionId: pageVersionIdSchema.make(11n)
      });
    const initial = material();
    const view = mount(() => useNotePageAutosave(initial));

    act(() => view.result.current.change(document('Draft')));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(9000);
    });
    expect(api.save).toHaveBeenCalledTimes(1);
    await act(async () => {
      await view.result.current.save();
    });
    expect(api.save.mock.calls[1]![0]).toEqual(api.save.mock.calls[0]![0]);
    await settle();
    expect(view.result.current.dirty).toBe(false);
  }
);

testStable('retains local edits on conflict until the user selects the saved version', async () => {
  api.save.mockResolvedValue({
    outcome: 'conflict',
    submittedVersionId: pageVersionIdSchema.make(12n)
  });
  const incoming = material('Another editor', 11n);

  api.material.mockResolvedValue(incoming);
  const initial = material();
  const view = mount(() => useNotePageAutosave(initial));

  act(() => view.result.current.change(document('Local')));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(3000);
  });
  await settle();
  expect(view.result.current.document.blocks[0]!.text).toBe('Local');
  expect(view.result.current.conflict?.id).toBe(initial.id);
  act(() => view.result.current.acceptSavedVersion());
  await settle();
  expect(view.result.current.document.blocks[0]!.text).toBe('Another editor');
});

testStable(
  'loads every attachment page rather than hiding pages beyond the first hundred',
  async () => {
    const item = material();

    api.list
      .mockResolvedValueOnce({ items: [item], nextCursor: item.id })
      .mockResolvedValueOnce({ items: [item], nextCursor: null });
    const client = new QueryClient();

    caches.push(client);
    const result = await client.fetchQuery(linkedPagesOptions(id));

    expect(result.items).toHaveLength(2);
    expect(api.list.mock.calls[1]![0]).toMatchObject({ cursor: item.id });
  }
);

testStable(
  'creates a subject-owned blank document and retries the same receipt without attaching a note',
  async () => {
    const projectId = projectIdSchema.make(7n);

    api.create
      .mockRejectedValueOnce(new StudyError('transient', 'offline'))
      .mockResolvedValueOnce(material());
    const view = mount(() => useBlankPageCreation({ kind: 'project', projectId }));

    await act(async () => {
      await view.result.current.create('Blank page');
    });
    const input = api.create.mock.calls[0]![0];

    expect(input).toMatchObject({
      projectId,
      title: 'Blank page',
      document: { blocks: [{ text: '' }] }
    });
    expect(input).not.toHaveProperty('noteId');
    await act(async () => {
      await view.result.current.create('A changed title');
    });
    expect(api.create.mock.calls[1]![0]).toEqual(input);
    await settle();
    expect(view.result.current.error).toBeUndefined();
  }
);
