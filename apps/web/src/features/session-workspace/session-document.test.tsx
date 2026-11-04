import { StudyError } from '@study/contracts/errors';
import { sessionIdSchema, materialVersionIdSchema } from '@study/contracts/ids';
import { materialDetailSchema } from '@study/contracts/materials/schemas';
import { plainBlock } from '@study/contracts/sources/document';
import { testStable } from '@study/testing/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, cleanup } from '@testing-library/react';
import { Schema } from 'effect';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, expect, vi } from 'vite-plus/test';

import { blankDocument } from '../document-editing';
import {
  useSessionDocumentCreation,
  useSessionDocumentAutosave,
  sessionDocumentsOptions
} from './session-document.queries';

const api = vi.hoisted(() => ({
  create: vi.fn(),
  save: vi.fn(),
  material: vi.fn(),
  list: vi.fn()
}));

vi.mock('#web/lib/study-client/request.ts', () => ({
  request: (invoke: (rpc: Record<string, unknown>) => unknown) =>
    invoke({
      'materials.createManualDocument': api.create,
      'materials.saveDocument': api.save,
      'materials.material': api.material,
      'materials.materials': api.list
    })
}));

const id = sessionIdSchema.make(1n);

const document = (text: string) => ({
  ...blankDocument(),
  blocks: [plainBlock('paragraph', text, { type: 'authored' })]
});

function material(text = '', versionId = 10n) {
  const version = {
    id: versionId,
    material_id: 2n,
    number: versionId,
    operation: 'original',
    creator: 'user',
    instruction: null,
    language: null,
    created_at: 1n,
    published_at: 1n,
    status: 'published',
    inputs: [],
    parents: [],
    kind: 'document',
    content: { kind: 'document', ...document(text) }
  };

  return Schema.decodeUnknownSync(materialDetailSchema)({
    id: 2n,
    projectIds: [],
    kind: 'document',
    title: 'New document',
    description: null,
    created_at: 1n,
    updated_at: 1n,
    archived_at: null,
    version,
    latestPublishedVersion: version,
    latestDraftVersion: null
  });
}

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
    const view = mount(() => useSessionDocumentCreation(id));

    await act(async () => {
      await view.result.current.create('New document');
    });
    const input = api.create.mock.calls[0]![0];

    expect(input).toMatchObject({
      sessionId: id,
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

testStable(
  'autosaves typed documents and flushes trailing edits after the tab closes',
  async () => {
    let finish!: (value: {
      outcome: 'saved';
      submittedVersionId: ReturnType<typeof materialVersionIdSchema.make>;
    }) => void;

    api.save
      .mockReturnValueOnce(
        new Promise((resolve) => {
          finish = resolve;
        })
      )
      .mockResolvedValue({
        outcome: 'saved',
        submittedVersionId: materialVersionIdSchema.make(12n)
      });
    const initial = material();
    const view = mount(() => useSessionDocumentAutosave(initial));
    const first = document('First');
    const last = document('Last');

    act(() => view.result.current.change(first));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(api.save.mock.calls[0]![0]).toMatchObject({
      materialId: initial.id,
      expectedVersionId: initial.version.id,
      document: first
    });
    act(() => view.result.current.change(last));
    view.unmount();
    await act(async () => {
      finish({ outcome: 'saved', submittedVersionId: materialVersionIdSchema.make(11n) });
    });
    expect(api.save).toHaveBeenCalledTimes(2);
    expect(api.save.mock.calls[1]![0]).toMatchObject({ document: last, expectedVersionId: 11n });
  }
);

testStable(
  'preserves a failed save payload and requires an explicit retry with the same save key',
  async () => {
    api.save
      .mockRejectedValueOnce(new StudyError('transient', 'lost receipt'))
      .mockResolvedValueOnce({
        outcome: 'saved',
        submittedVersionId: materialVersionIdSchema.make(11n)
      });
    const initial = material();
    const view = mount(() => useSessionDocumentAutosave(initial));

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
    submittedVersionId: materialVersionIdSchema.make(12n)
  });
  const incoming = material('Another editor', 11n);

  api.material.mockResolvedValue(incoming);
  const initial = material();
  const view = mount(() => useSessionDocumentAutosave(initial));

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
  'loads every attachment page rather than hiding documents beyond the first hundred',
  async () => {
    const item = material();

    api.list
      .mockResolvedValueOnce({ items: [item], nextCursor: item.id })
      .mockResolvedValueOnce({ items: [item], nextCursor: null });
    const client = new QueryClient();

    caches.push(client);
    const result = await client.fetchQuery(sessionDocumentsOptions(id));

    expect(result.items).toHaveLength(2);
    expect(api.list.mock.calls[1]![0]).toMatchObject({ cursor: item.id });
  }
);
