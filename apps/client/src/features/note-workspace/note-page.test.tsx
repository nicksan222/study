import { StudyError, noteIdSchema, editOutcomeSchema, plainBlock } from '@study/contracts';
import { RpcProvider, configureRpcTransport } from '@study/contracts/react';
import { test } from '@study/testing';
import { Schema } from 'effect';
import { AtomRegistry } from 'effect/reactivity';
import type { ReactNode } from 'react';

import type * as __MockType0 from '../document-editing';
import type * as __MockType1 from '../document-editing/test-support';
import type * as __MockType2 from './note-page.queries';

let blankDocument: typeof __MockType0.blankDocument;

let authoredPage: typeof __MockType1.authoredPage;

let useNotePageAutosave: typeof __MockType2.useNotePageAutosave;

let useLinkedPages: typeof __MockType2.useLinkedPages;

let api: ReturnType<typeof createMockState>['api'];

const saveReceipt = (outcome: 'saved' | 'conflict', submitted: bigint, expected = 10n) =>
  Schema.decodeUnknownSync(editOutcomeSchema)({
    outcome,
    replayed: false,
    expectedVersionId: expected,
    submittedVersionId: submitted,
    currentVersionId: outcome === 'conflict' ? 11n : submitted
  });

const id = noteIdSchema.make(1n);

function initializeDocument() {
  return (text: string) => ({
    ...blankDocument(),
    blocks: [plainBlock('paragraph', text, { type: 'authored' })]
  });
}

let document: ReturnType<typeof initializeDocument>;

function initializeMaterial() {
  return (text = '', versionId = 10n) => authoredPage(2n, text, versionId);
}

let material: ReturnType<typeof initializeMaterial>;

const registries: AtomRegistry.AtomRegistry[] = [];

function mount<T>(
  { rpcTestTransport, renderHook }: Pick<test.unit.Context, 'rpcTestTransport' | 'renderHook'>,
  hook: () => T,
  registry = AtomRegistry.make()
) {
  registries.push(registry);
  const fixture = rpcTestTransport(async (tag, input) => {
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

function createMockState(mock: test.Mock) {
  return {
    api: (() => ({
      save: mock.fn(),
      material: mock.fn(),
      list: mock.fn()
    }))()
  };
}

test.unit.beforeEach(async ({ mock }) => {
  const __mockState = createMockState(mock);

  api = __mockState.api;

  const __mockModule0 = await import('../document-editing');

  blankDocument = __mockModule0.blankDocument;
  const __mockModule1 = await import('../document-editing/test-support');

  authoredPage = __mockModule1.authoredPage;
  const __mockModule2 = await import('./note-page.queries');

  useNotePageAutosave = __mockModule2.useNotePageAutosave;
  useLinkedPages = __mockModule2.useLinkedPages;
  document = initializeDocument();
  material = initializeMaterial();
});

test.unit.beforeEach(({ vi }) => {
  vi.useFakeTimers();
  vi.resetAllMocks();
});
test.unit.afterEach(({ cleanup, vi }) => {
  cleanup();
  registries.splice(0).forEach((registry) => registry.dispose());
  vi.useRealTimers();
});

async function settle({ act, vi }: Pick<test.unit.Context, 'act' | 'vi'>) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
}

test.unit.stable(
  'autosaves typed pages and flushes trailing edits after the tab closes',
  async ({ act, vi, expect, rpcTestTransport, renderHook }) => {
    let finish!: (value: typeof editOutcomeSchema.Type) => void;

    api.save
      .mockReturnValueOnce(
        new Promise((resolve) => {
          finish = resolve;
        })
      )
      .mockResolvedValue(saveReceipt('saved', 12n, 11n));
    const initial = material();
    const view = mount({ rpcTestTransport, renderHook }, () => useNotePageAutosave(initial));
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
  }
);

test.unit.stable(
  'preserves a failed save payload and requires an explicit retry with the same save key',
  async ({ act, vi, expect, rpcTestTransport, renderHook }) => {
    api.save
      .mockRejectedValueOnce(new StudyError('transient', 'lost receipt'))
      .mockResolvedValueOnce(saveReceipt('saved', 11n, 10n));
    const initial = material();
    const view = mount({ rpcTestTransport, renderHook }, () => useNotePageAutosave(initial));

    act(() => view.result.current.change(document('Draft')));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(9000);
    });
    expect(api.save).toHaveBeenCalledTimes(1);
    await act(async () => {
      await view.result.current.save();
    });
    expect(api.save.mock.calls[1]![0]).toEqual(api.save.mock.calls[0]![0]);
    await settle({ act, vi });
    expect(view.result.current.dirty).toBe(false);
  }
);

test.unit.stable(
  'retains local edits on conflict until the user selects the saved version',
  async ({ act, vi, expect, rpcTestTransport, renderHook }) => {
    api.save.mockResolvedValue(saveReceipt('conflict', 12n, 10n));
    const incoming = material('Another editor', 11n);

    api.material.mockResolvedValue(incoming);
    const initial = material();
    const view = mount({ rpcTestTransport, renderHook }, () => useNotePageAutosave(initial));

    act(() => view.result.current.change(document('Local')));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    await settle({ act, vi });
    expect(view.result.current.document.blocks[0]!.text).toBe('Local');
    expect(view.result.current.conflict?.id).toBe(initial.id);
    act(() => view.result.current.acceptSavedVersion());
    await settle({ act, vi });
    expect(view.result.current.document.blocks[0]!.text).toBe('Another editor');
  }
);

test.unit.stable(
  'linked attachment pages remain bounded and request continuation only explicitly',
  async ({ expect, act, rpcTestTransport, renderHook, vi }) => {
    const item = material();

    api.list.mockImplementation(async ({ limit }) => ({
      items: [item],
      nextCursor: limit < 60 ? item.id : null
    }));
    const view = mount({ rpcTestTransport, renderHook }, () => useLinkedPages(id));

    await settle({ act, vi });
    expect(view.result.current.data?.items).toHaveLength(1);
    expect(api.list).toHaveBeenCalledTimes(1);
    expect(api.list.mock.calls[0]![0]).toMatchObject({ noteId: id, limit: 30 });
    await act(async () => view.result.current.pagination.more(item.id));
    await settle({ act, vi });
    expect(api.list.mock.calls.at(-1)![0]).toMatchObject({ noteId: id, limit: 60 });
  }
);
