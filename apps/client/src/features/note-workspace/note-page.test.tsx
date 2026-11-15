import { StudyError } from '@study/contracts/errors';
import { noteIdSchema, projectIdSchema } from '@study/contracts/ids';
import { editOutcomeSchema } from '@study/contracts/pages/editing';
import { RpcProvider, configureRpcTransport } from '@study/contracts/react';
import { plainBlock } from '@study/contracts/sources/document';
import { testStable } from '@study/testing/vitest';
import { act, renderHook, cleanup } from '@testing-library/react';
import { Schema } from 'effect';
import { AtomRegistry } from 'effect/reactivity';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, expect, vi } from 'vite-plus/test';

import { rpcTestTransport } from '#client/test/rpc.tsx';

import { blankDocument } from '../document-editing';
import { authoredPage } from '../document-editing/test-support';
import {
  useNotePageCreation,
  useBlankPageCreation,
  useNotePageAutosave,
  useLinkedPages
} from './note-page.queries';

const api = vi.hoisted(() => ({
  create: vi.fn(),
  save: vi.fn(),
  material: vi.fn(),
  list: vi.fn()
}));

const saveReceipt = (outcome: 'saved' | 'conflict', submitted: bigint, expected = 10n) =>
  Schema.decodeUnknownSync(editOutcomeSchema)({
    outcome,
    replayed: false,
    expectedVersionId: expected,
    submittedVersionId: submitted,
    currentVersionId: outcome === 'conflict' ? 11n : submitted
  });

const id = noteIdSchema.make(1n);

const document = (text: string) => ({
  ...blankDocument(),
  blocks: [plainBlock('paragraph', text, { type: 'authored' })]
});

const material = (text = '', versionId = 10n) => authoredPage(2n, text, versionId);

const registries: AtomRegistry.AtomRegistry[] = [];

function mount<T>(hook: () => T, registry = AtomRegistry.make()) {
  registries.push(registry);
  const fixture = rpcTestTransport(async (tag, input) => {
    if (tag === 'pages.create') return api.create(input);

    if (tag === 'pages.save') return api.save(input);

    if (tag === 'pages.page') return api.material(input);

    if (tag === 'pages.pages') return api.list(input);

    throw new Error(`Unexpected ${tag}`);
  });

  configureRpcTransport(fixture.transport);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <RpcProvider transport={fixture.transport} registry={registry}>
      {children}
    </RpcProvider>
  );

  return { registry, ...renderHook(hook, { wrapper }) };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetAllMocks();
});
afterEach(() => {
  cleanup();
  registries.splice(0).forEach((registry) => registry.dispose());
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
      await view.result.current.create('New page');
    });
    const input = api.create.mock.calls[0]![0];

    expect(input).toMatchObject({
      noteId: id,
      title: 'New page',
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
  let finish!: (value: typeof editOutcomeSchema.Type) => void;

  api.save
    .mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      })
    )
    .mockResolvedValue(saveReceipt('saved', 12n, 11n));
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
    finish(saveReceipt('saved', 11n, 10n));
  });
  expect(api.save).toHaveBeenCalledTimes(2);
  expect(api.save.mock.calls[1]![0]).toMatchObject({ document: last, expectedVersionId: 11n });
});

testStable(
  'preserves a failed save payload and requires an explicit retry with the same save key',
  async () => {
    api.save
      .mockRejectedValueOnce(new StudyError('transient', 'lost receipt'))
      .mockResolvedValueOnce(saveReceipt('saved', 11n, 10n));
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
  api.save.mockResolvedValue(saveReceipt('conflict', 12n, 10n));
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
  'linked attachment pages remain bounded and request continuation only explicitly',
  async () => {
    const item = material();

    api.list.mockImplementation(async ({ limit }) => ({
      items: [item],
      nextCursor: limit < 60 ? item.id : null
    }));
    const view = mount(() => useLinkedPages(id));

    await settle();
    expect(view.result.current.data?.items).toHaveLength(1);
    expect(api.list).toHaveBeenCalledTimes(1);
    expect(api.list.mock.calls[0]![0]).toMatchObject({ noteId: id, limit: 30 });
    await act(async () => view.result.current.pagination.more(item.id));
    await settle();
    expect(api.list.mock.calls.at(-1)![0]).toMatchObject({ noteId: id, limit: 60 });
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
